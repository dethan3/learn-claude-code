// s10: Runtime Modes — mini Pi 的第 10 版
//
// core 只产生事件，怎么展示由外层 mode 决定。[R7 收获] s01 的 Output 抽象，长成可切换的 RuntimeMode。
// 词汇边界：本章新增 RuntimeMode / PrintMode / JsonMode / createDemoRuntimeEvents / render。
// 关键：Output 保留（过程打印），RuntimeMode 新增（结果展示）；同一个 core 产同一批事件，不同 mode 展示成不同形式。

declare const process: {
  exitCode?: number;
};

// —— 停止原因（s04 起）——
export type StopReason = "stop" | "toolUse" | "error";

// —— 消息 ——
export type UserMessage = { role: "user"; content: string };
export type AssistantMessage = { role: "assistant"; content: string; stopReason: StopReason };
export type ToolResultMessage = { role: "toolResult"; toolCallId: string; content: string };
export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

// —— 会话历史（s07 起）——
export type SessionEntry = { id: string; parentId: string | null; message: AgentMessage };
export class SessionTree {
  private entries = new Map<string, SessionEntry>();
  private activeLeafId: string | null = null;
  private counter = 0;
  append(message: AgentMessage): SessionEntry {
    const entry = { id: `e${++this.counter}`, parentId: this.activeLeafId, message };
    this.entries.set(entry.id, entry);
    this.activeLeafId = entry.id;
    return entry;
  }
  moveTo(entryId: string): void {
    if (!this.entries.has(entryId)) throw new Error(`unknown entry: ${entryId}`);
    this.activeLeafId = entryId;
  }
  currentPath(): AgentMessage[] {
    const path: AgentMessage[] = [];
    let cursor = this.activeLeafId;
    while (cursor) {
      const entry = this.entries.get(cursor);
      if (!entry) break;
      path.push(entry.message);
      cursor = entry.parentId;
    }
    return path.reverse();
  }
  allEntries(): SessionEntry[] { return [...this.entries.values()]; }
}
export type AgentState = { session: SessionTree; model: string };

// —— 工具契约（s02 起）——
export type ToolSpec = { name: string; description: string; input: Record<string, string> };
export type ToolHandler = (input: Record<string, string>) => string;
export type ToolCall = { id: string; name: string; input: Record<string, string> };
export type Tool = { spec: ToolSpec; handler: ToolHandler };
export class ToolRegistry {
  private tools = new Map<string, Tool>();
  register(tool: Tool): void { this.tools.set(tool.spec.name, tool); }
  getSpecs(): ToolSpec[] { return [...this.tools.values()].map((tool) => tool.spec); }
  count(): number { return this.tools.size; }
  run(call: ToolCall): string {
    const tool = this.tools.get(call.name);
    if (!tool) return `unknown tool: ${call.name}`;
    return tool.handler(call.input);
  }
}

// —— 上下文资源（s08 起）——
export type ContextResource = { kind: "agents" | "skill" | "prompt"; name: string; content: string };
export class ResourceLoader {
  constructor(private resources: ContextResource[]) {}
  load(): ContextResource[] { return this.resources.map((r) => ({ ...r })); }
}
// s08：资源组装进 systemPrompt（对齐 Pi buildSystemPrompt）
export function buildSystemPrompt(resources: ContextResource[]): string {
  return resources.map((r) => `[${r.kind}:${r.name}]\n${r.content}`).join("\n\n");
}

// —— provider 对外 ——
export type ProviderMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "toolResult"; toolCallId: string; content: string };
export type ProviderInput = { systemPrompt: string; messages: ProviderMessage[]; tools: ToolSpec[] };
export type ProviderEvent =
  | { type: "message_start" }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "message_end"; stopReason: StopReason };
export interface Provider { stream(input: ProviderInput): AsyncGenerator<ProviderEvent>; }

// —— s01 起：输出抽象（R7。s10 会再加 RuntimeMode，两者并存）——
export type Output = { log(line: string): void };
export function createConsoleOutput(): Output { return { log: (line) => console.log(line) }; }

// —— s05 起：执行插口 ——
export type BeforeToolCallResult = { type: "allow" } | { type: "block"; reason: string };
export type ToolHooks = {
  beforeToolCall?: (call: ToolCall) => BeforeToolCallResult;
  afterToolCall?: (call: ToolCall, result: string) => string;
};
export function executeToolCall(registry: ToolRegistry, hooks: ToolHooks, call: ToolCall): ToolResultMessage {
  const before = hooks.beforeToolCall?.(call) ?? { type: "allow" };
  if (before.type === "block") {
    return { role: "toolResult", toolCallId: call.id, content: `blocked: ${before.reason}` };
  }
  let result: string;
  try { result = registry.run(call); }
  catch (error) { result = `error: ${error instanceof Error ? error.message : String(error)}`; }
  const finalResult = hooks.afterToolCall?.(call, result) ?? result;
  return { role: "toolResult", toolCallId: call.id, content: finalResult };
}

// —— s06 起：一轮快照 ——
export type TurnSnapshot = { systemPrompt: string; messages: ProviderMessage[]; tools: ToolSpec[] };
function toProviderMessages(messages: AgentMessage[]): ProviderMessage[] {
  return messages.map((message) => {
    if (message.role === "toolResult") {
      return { role: "toolResult", toolCallId: message.toolCallId, content: message.content };
    }
    return { role: message.role, content: message.content };
  });
}
export function createTurnSnapshot(state: AgentState, registry: ToolRegistry, loader: ResourceLoader): TurnSnapshot {
  return {
    systemPrompt: buildSystemPrompt(loader.load()),
    messages: toProviderMessages(state.session.currentPath()),
    tools: registry.getSpecs(),
  };
}
export function buildProviderInputFromSnapshot(snapshot: TurnSnapshot, state: AgentState): ProviderInput {
  return {
    systemPrompt: snapshot.systemPrompt,
    messages: toProviderMessages(state.session.currentPath()),
    tools: snapshot.tools,
  };
}

// ============ 构造函数 ============
export function createInitialState(model = "demo-small"): AgentState { return { session: new SessionTree(), model }; }
export function createUserMessage(content: string): UserMessage { return { role: "user", content }; }

// ============ 工具循环（s04 起，保留不动）============
const MAX_TURNS = 8;
export async function runEventedToolLoop(
  state: AgentState, provider: Provider, registry: ToolRegistry,
  hooks: ToolHooks, snapshot: TurnSnapshot, output: Output,
): Promise<AssistantMessage> {
  let turns = 0;
  while (true) {
    turns += 1;
    if (turns > MAX_TURNS) {
      const stopped: AssistantMessage = { role: "assistant", content: "(达到最大轮次，停止)", stopReason: "stop" };
      state.session.append(stopped);
      return stopped;
    }
    const providerInput = buildProviderInputFromSnapshot(snapshot, state);
    let content = "";
    let stopReason: StopReason = "stop";
    let sawToolCall = false;
    for await (const event of provider.stream(providerInput)) {
      if (event.type === "message_start") output.log("message_start");
      else if (event.type === "text_delta") { output.log(`text_delta: ${event.text}`); content += event.text; }
      else if (event.type === "tool_call") {
        sawToolCall = true;
        output.log(`tool_call: ${event.call.name}`);
        const resultMessage = executeToolCall(registry, hooks, event.call);
        state.session.append(resultMessage);
        output.log(`tool_result: ${resultMessage.content}`);
      } else if (event.type === "message_end") { stopReason = event.stopReason; output.log(`message_end: ${stopReason}`); }
    }
    if (!sawToolCall || stopReason !== "toolUse") {
      const assistant: AssistantMessage = { role: "assistant", content, stopReason };
      state.session.append(assistant);
      return assistant;
    }
  }
}

// ============ s09 起：扩展运行时 ============
export type RuntimeEvent = { type: "message"; content: string } | { type: "done" }; // U2 全局唯一
type EventHandler<T extends RuntimeEvent["type"]> = (event: Extract<RuntimeEvent, { type: T }>) => void;
export type Command = { name: string; run: () => string };
export type ExtensionAPI = {
  on<T extends RuntimeEvent["type"]>(type: T, handler: EventHandler<T>): void;
  registerTool(tool: Tool): void;
  registerCommand(command: Command): void;
};
export type Extension = (api: ExtensionAPI) => void;
export class ExtensionRuntime {
  private commands = new Map<string, Command>();
  private handlers: { type: RuntimeEvent["type"]; handler: (event: RuntimeEvent) => void }[] = [];
  constructor(private registry: ToolRegistry) {}
  createApi(): ExtensionAPI {
    return {
      on: (type, handler) => { this.handlers.push({ type, handler: handler as (event: RuntimeEvent) => void }); },
      registerTool: (tool) => { this.registry.register(tool); },
      registerCommand: (command) => { this.commands.set(command.name, command); },
    };
  }
  use(extension: Extension): void { extension(this.createApi()); }
  emit(event: RuntimeEvent): void {
    for (const { type, handler } of this.handlers) if (type === event.type) handler(event);
  }
  runCommand(name: string): string {
    const command = this.commands.get(name);
    if (!command) return `unknown command: ${name}`;
    return command.run();
  }
}

// ============ s10 新增 [R7 收获]：运行方式（输出分离）============

// 为了压缩本节 demo，只造一批最小 RuntimeEvent。
// 它不是替换前面累积出来的 tool loop，只是演示 mode 如何消费同一批事件。
export function createDemoRuntimeEvents(input: string): RuntimeEvent[] {
  return [
    { type: "message", content: `收到：${input}` },
    { type: "done" },
  ];
}

// 输出方式：消费同一批事件，展示成不同形式。
export type RuntimeMode = {
  render(events: RuntimeEvent[]): void;
};

// 人类可读：只打印 message 的内容。
export class PrintMode implements RuntimeMode {
  render(events: RuntimeEvent[]): void {
    for (const event of events) {
      if (event.type === "message") {
        console.log(event.content);
      }
    }
  }
}

// 结构化：每个事件一行 JSON，给机器消费。
export class JsonMode implements RuntimeMode {
  render(events: RuntimeEvent[]): void {
    for (const event of events) {
      console.log(JSON.stringify(event));
    }
  }
}

// ============ 演示脚手架 ============

function main(): void {
  const events = createDemoRuntimeEvents("你好，mini Pi");

  console.log("s10: Runtime Modes");
  console.log("");

  console.log("[print mode]");
  new PrintMode().render(events);
  console.log("");

  console.log("[json mode]");
  new JsonMode().render(events);
  console.log("");
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
