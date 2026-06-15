// s11: Trust and Execution Boundary — mini Pi 的第 11 版
//
// 对齐 Pi 真实设计：trust 控制资源加载；执行边界不内置 permission，靠部署层 containerization。
// 词汇边界：本章新增 ProjectTrust / trust / trusted / untrusted；containerization 三方案（README 讲）。
// 关键：移除了教学版的 ExecutionPolicy/Executor（Pi 里没有）；executeToolCall 回到无 policy（s05 版本）。

declare const process: {
  argv: string[];
  exitCode?: number;
};

// ============ s11 新增：项目信任（控制资源加载）============

// 项目可不可信：决定要不要加载它的资料（防恶意 AGENTS.md / 扩展）。
export type ProjectTrust = "trusted" | "untrusted";

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

// —— 工具契约 ——
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

// —— 上下文资源（s08 起；s11：load 加 trust 参数，U1）——
export type ContextResource = { kind: "agents" | "skill" | "prompt"; name: string; content: string };
export class ResourceLoader {
  constructor(private resources: ContextResource[]) {}
  // [U1 升级] 加 trust 参数。untrusted → 不加载任何资料。默认 trusted。
  load(trust: ProjectTrust = "trusted"): ContextResource[] {
    if (trust === "untrusted") return [];
    return this.resources.map((r) => ({ ...r }));
  }
}
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

// —— s05 起：执行插口（无 policy——Pi 不内置执行权限）——
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

// —— s06 起快照（s11：createTurnSnapshot 加 trust，传给 load）——
export type TurnSnapshot = { systemPrompt: string; messages: ProviderMessage[]; tools: ToolSpec[] };
function toProviderMessages(messages: AgentMessage[]): ProviderMessage[] {
  return messages.map((message) => {
    if (message.role === "toolResult") {
      return { role: "toolResult", toolCallId: message.toolCallId, content: message.content };
    }
    return { role: message.role, content: message.content };
  });
}
export function createTurnSnapshot(
  state: AgentState, registry: ToolRegistry, loader: ResourceLoader, trust: ProjectTrust = "trusted",
): TurnSnapshot {
  return {
    systemPrompt: buildSystemPrompt(loader.load(trust)),
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

export function createInitialState(model = "demo-small"): AgentState { return { session: new SessionTree(), model }; }
export function createUserMessage(content: string): UserMessage { return { role: "user", content }; }

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

// —— s09 起：扩展运行时（累积）——
export type RuntimeEvent = { type: "message"; content: string } | { type: "done" };
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

// —— s10 起：运行方式（累积）——
export function createDemoRuntimeEvents(input: string): RuntimeEvent[] {
  return [{ type: "message", content: `收到：${input}` }, { type: "done" }];
}
export type RuntimeMode = { render(events: RuntimeEvent[]): void };
export class PrintMode implements RuntimeMode {
  render(events: RuntimeEvent[]): void {
    for (const event of events) if (event.type === "message") console.log(event.content);
  }
}
export class JsonMode implements RuntimeMode {
  render(events: RuntimeEvent[]): void {
    for (const event of events) console.log(JSON.stringify(event));
  }
}

// ============ 演示脚手架 ============

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function main(): void {
  const output = createConsoleOutput();
  const trust: ProjectTrust = readArg("--trust") === "untrusted" ? "untrusted" : "trusted";

  const loader = new ResourceLoader([
    { kind: "agents", name: "AGENTS.md", content: "Use concise engineering explanations." },
  ]);

  output.log("s11: Trust and Execution Boundary");
  output.log("");

  // 加载边界：看 trust。untrusted → 不加载资料（防恶意资源）。
  const resources = loader.load(trust);
  output.log("[resources]");
  if (resources.length === 0) {
    output.log("none（untrusted，不加载任何资料）");
  } else {
    for (const resource of resources) {
      output.log(resource.name);
    }
  }
  output.log("");

  // 执行边界：对齐 Pi——core 不内置 permission，靠部署层 containerization。
  output.log("[execution boundary]");
  output.log("Pi 不在 core 内限制执行权限。执行边界靠部署层 containerization：");
  output.log("- OpenShell：整个 pi 进程跑在策略控制的沙箱");
  output.log("- Gondolin：pi 留主机，工具执行路由到 Linux 微虚拟机");
  output.log("- Plain Docker：整个 pi 进程跑在本地容器");
  output.log("core 内唯一的执行拦截点是 s05 的 beforeToolCall hook。");
  output.log("");
}

try {
  main();
} catch (error: unknown) {
  console.error(error);
  process.exitCode = 1;
}
