// s09: Extension Runtime — mini Pi 的第 9 版
//
// 外部代码通过公开 API 接入 core：订阅事件、注册工具、注册命令。core 不用动就能长出新能力。
// 词汇边界：本章新增 Extension / ExtensionAPI / ExtensionRuntime / Command / RuntimeEvent / on / registerTool / registerCommand / emit / use。
// 关键：registerTool 复用既有 Tool 类型，注入现有 ToolRegistry——extension 的工具和内置工具走同一条执行链。

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

// ============ 工具循环（不变）============
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

// ============ s09 新增：扩展运行时 ============

// U2 全局唯一：s09 定义，s10 复用。
export type RuntimeEvent =
  | { type: "message"; content: string }
  | { type: "done" };

// 命令：一个不带参数、返回字符串的动作。
export type Command = { name: string; run: () => string };

// 订阅某类事件时，handler 收到的事件结构自动对应（订阅 "message" 就只收 message 事件）。
type EventHandler<T extends RuntimeEvent["type"]> = (
  event: Extract<RuntimeEvent, { type: T }>,
) => void;

// extension 能接触的全部表面。
export type ExtensionAPI = {
  on<T extends RuntimeEvent["type"]>(type: T, handler: EventHandler<T>): void;
  registerTool(tool: Tool): void;        // 复用 s02 的 Tool
  registerCommand(command: Command): void;
};

// 一个 extension 就是一个接收 API 的函数。
export type Extension = (api: ExtensionAPI) => void;

export class ExtensionRuntime {
  private registry: ToolRegistry; // 复用既有 registry：extension 注册的工具和内置工具同源
  private commands = new Map<string, Command>();
  private handlers: { type: RuntimeEvent["type"]; handler: (event: RuntimeEvent) => void }[] = [];

  constructor(registry: ToolRegistry) {
    this.registry = registry;
  }

  // 外部只能拿到这个 API，拿不到 runtime 内部字段。
  createApi(): ExtensionAPI {
    return {
      on: (type, handler) => {
        this.handlers.push({
          type,
          handler: handler as (event: RuntimeEvent) => void,
        });
      },
      registerTool: (tool) => {
        this.registry.register(tool); // 注入既有 registry，走同一执行链
      },
      registerCommand: (command) => {
        this.commands.set(command.name, command);
      },
    };
  }

  use(extension: Extension): void {
    extension(this.createApi());
  }

  // 按事件类型分发（不是全部 handler 都调）。
  emit(event: RuntimeEvent): void {
    for (const { type, handler } of this.handlers) {
      if (type === event.type) {
        handler(event);
      }
    }
  }

  runCommand(name: string): string {
    const command = this.commands.get(name);
    if (!command) return `unknown command: ${name}`;
    return command.run();
  }
}

// ============ Demo Provider（保留，累积）============
export class DemoProvider implements Provider {
  public lastInput: ProviderInput | undefined;
  async *stream(input: ProviderInput): AsyncGenerator<ProviderEvent> {
    this.lastInput = input;
    const last = input.messages[input.messages.length - 1];
    yield { type: "message_start" };
    if (last?.role === "toolResult") {
      yield { type: "text_delta", text: `工具结果是：${last.content}` };
      yield { type: "message_end", stopReason: "stop" };
      return;
    }
    yield { type: "tool_call", call: { id: "call_1", name: "current_time", input: {} } };
    yield { type: "message_end", stopReason: "toolUse" };
  }
}

// ============ 演示脚手架 ============

function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    spec: { name: "current_time", description: "返回一个固定的演示时间", input: {} },
    handler: () => "2026-01-01T00:00:00Z",
  });
  return registry;
}

// 一个 demo extension：订阅事件、注册命令、注册工具。全部通过 API，不碰 core 内部。
function createDemoExtension(output: Output): Extension {
  return (api) => {
    api.on("message", (event) => {
      output.log(`[event] message: ${event.content}`);
    });
    api.registerCommand({ name: "status", run: () => "extension is active" });
    api.registerTool({
      spec: { name: "note", description: "保存一条笔记", input: { text: "内容" } },
      handler: (input) => `note saved: ${input.text ?? ""}`,
    });
  };
}

async function main(): Promise<void> {
  const output = createConsoleOutput();
  const registry = createRegistry();
  const runtime = new ExtensionRuntime(registry);

  output.log("s09: Extension Runtime");
  output.log("");

  // extension 接入：通过 API 注册能力。
  runtime.use(createDemoExtension(output));

  // 注册后，registry 里既有内置工具，也有 extension 注册的工具。
  output.log("[registry]");
  for (const spec of registry.getSpecs()) {
    output.log(`tool: ${spec.name}`);
  }
  output.log("");

  // 事件：core emit，extension 的 handler 被触发（按类型匹配）。
  runtime.emit({ type: "message", content: "hello from core" });
  output.log("");

  // 命令。
  output.log("[command]");
  output.log(`/status -> ${runtime.runCommand("status")}`);
  output.log("");

  // extension 注册的工具，走既有执行链（executeToolCall）。
  output.log("[tool via extension]");
  const result = executeToolCall(
    registry,
    {},
    { id: "c1", name: "note", input: { text: "hi" } },
  );
  output.log(`note -> ${result.content}`);
  output.log("");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
