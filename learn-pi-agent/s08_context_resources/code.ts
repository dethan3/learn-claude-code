// s08: Context Resources — mini Pi 的第 8 版
//
// 把项目资料组装进 systemPrompt（对齐 Pi buildSystemPrompt），不再是独立 context 字段。
// 词汇边界：本章新增 ContextResource / ResourceLoader / buildSystemPrompt / systemPrompt。
// 关键（对齐 Pi Context）：ProviderInput 加 systemPrompt（资料进去）；tools 保留（R1）。

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

// —— core 状态（s06 起：model 跨轮配置）——
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

// ============ s08 新增：项目资料（组装进 systemPrompt）============

export type ContextResource = { kind: "agents" | "skill" | "prompt"; name: string; content: string };

// U2 全局唯一：s08 定义，s11 会给 load 加 trust 参数（U1）。
export class ResourceLoader {
  constructor(private resources: ContextResource[]) {}
  load(): ContextResource[] {
    return this.resources.map((resource) => ({ ...resource }));
  }
}

// 把资源组装进 systemPrompt（对齐 Pi buildSystemPrompt），每份带上来源标记。
export function buildSystemPrompt(resources: ContextResource[]): string {
  return resources
    .map((resource) => `[${resource.kind}:${resource.name}]\n${resource.content}`)
    .join("\n\n");
}

// —— provider 对外（对齐 Pi Context：systemPrompt + messages + tools）——
export type ProviderMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "toolResult"; toolCallId: string; content: string };

export type ProviderInput = {
  systemPrompt: string;   // s08 新增：项目资料组装进去（对齐 Pi Context.systemPrompt）
  messages: ProviderMessage[];
  tools: ToolSpec[];      // s02 起，保留（R1）
};

export type ProviderEvent =
  | { type: "message_start" }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "message_end"; stopReason: StopReason };

export interface Provider {
  stream(input: ProviderInput): AsyncGenerator<ProviderEvent>;
}

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

// —— s06 起快照（s08：加 systemPrompt）——
export type TurnSnapshot = {
  systemPrompt: string;
  messages: ProviderMessage[];
  tools: ToolSpec[];
};

function toProviderMessages(messages: AgentMessage[]): ProviderMessage[] {
  return messages.map((message) => {
    if (message.role === "toolResult") {
      return { role: "toolResult", toolCallId: message.toolCallId, content: message.content };
    }
    return { role: message.role, content: message.content };
  });
}

// s08：createTurnSnapshot 多接收 loader，把 systemPrompt 一起拍进快照。
export function createTurnSnapshot(
  state: AgentState,
  registry: ToolRegistry,
  loader: ResourceLoader,
): TurnSnapshot {
  return {
    systemPrompt: buildSystemPrompt(loader.load()),
    messages: toProviderMessages(state.session.currentPath()),
    tools: registry.getSpecs(),
  };
}

export function buildProviderInputFromSnapshot(
  snapshot: TurnSnapshot,
  state: AgentState,
): ProviderInput {
  return {
    systemPrompt: snapshot.systemPrompt,
    messages: toProviderMessages(state.session.currentPath()),
    tools: snapshot.tools,
  };
}

// ============ 构造函数 ============
export function createInitialState(model = "demo-small"): AgentState {
  return { session: new SessionTree(), model };
}
export function createUserMessage(content: string): UserMessage { return { role: "user", content }; }

// ============ 工具循环（不变，用 snapshot）============
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

function createLoader(): ResourceLoader {
  return new ResourceLoader([
    { kind: "agents", name: "AGENTS.md", content: "Use concise engineering explanations." },
    { kind: "skill", name: "repo-review", content: "Inspect package.json first. Then summarize risks." },
    { kind: "prompt", name: "summarize", content: "Return three bullets and one next step." },
  ]);
}

async function main(): Promise<void> {
  const output = createConsoleOutput();
  const state = createInitialState("demo-small");
  const registry = createRegistry();
  const loader = createLoader();

  output.log("s08: Context Resources");
  output.log("");

  const resources = loader.load();
  output.log("[resources]");
  for (const resource of resources) {
    output.log(`${resource.kind}: ${resource.name}`);
  }
  output.log("");

  // 一轮开始：push 用户消息，拍快照（含 systemPrompt）。
  state.session.append(createUserMessage("请总结这个项目"));
  const snapshot = createTurnSnapshot(state, registry, loader);
  const input = buildProviderInputFromSnapshot(snapshot, state);

  output.log("[provider input]");
  output.log(`systemPrompt blocks: ${resources.length}`);
  output.log(`messages: ${input.messages.length}`);
  output.log(`tools: ${input.tools.length}`);
  output.log("");

  output.log("[systemPrompt]");
  output.log(input.systemPrompt);
  output.log("");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
