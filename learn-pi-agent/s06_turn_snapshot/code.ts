// s06: Turn Snapshot — mini Pi 的第 6 版
//
// 一轮开始时先拍一份快照：messages/tools 固定下来，本轮不再受外部改动影响。
// 词汇边界：本章新增 TurnSnapshot / createTurnSnapshot / buildProviderInputFromSnapshot。
// 关键（对齐 Pi）：model 是跨轮配置，放 AgentState，不进单轮快照（Pi 的 AgentContext 也不含 model）。

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

// —— core 内部状态（s06：加 model 跨轮配置，对齐 Pi AgentState）——
export type AgentState = {
  messages: AgentMessage[];   // s07 会升级为 SessionTree（U1）
  model: string;              // s06 起加：跨轮配置，不在单轮快照里
};

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

// —— provider 对外（对齐 Pi Context：messages + tools；model 在 state）——
export type ProviderMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "toolResult"; toolCallId: string; content: string };
export type ProviderInput = { messages: ProviderMessage[]; tools: ToolSpec[] };

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
  try {
    result = registry.run(call);
  } catch (error) {
    result = `error: ${error instanceof Error ? error.message : String(error)}`;
  }
  const finalResult = hooks.afterToolCall?.(call, result) ?? result;
  return { role: "toolResult", toolCallId: call.id, content: finalResult };
}

// ============ s06 新增：一轮快照 ============

// 对齐 Pi AgentContext：固定 messages/tools。model 在 AgentState，不进快照。
export type TurnSnapshot = {
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

export function createTurnSnapshot(state: AgentState, registry: ToolRegistry): TurnSnapshot {
  return {
    messages: toProviderMessages(state.messages),
    tools: registry.getSpecs(),
  };
}

// 本轮 provider 输入：messages 取实时（循环内会增长），tools 取快照（固定）。
// model 在 state，不进 ProviderInput（对齐 Pi：调用 provider 时单独传 model）。
export function buildProviderInputFromSnapshot(
  snapshot: TurnSnapshot,
  state: AgentState,
): ProviderInput {
  return {
    messages: toProviderMessages(state.messages),
    tools: snapshot.tools,
  };
}

// ============ 构造函数 ============
export function createInitialState(model = "demo-small"): AgentState {
  return { messages: [], model };
}
export function createUserMessage(content: string): UserMessage { return { role: "user", content }; }

export function snapshotToolsCount(snapshot: TurnSnapshot): number {
  return snapshot.tools.length;
}

// ============ 工具循环（s06：接收外部拍好的 snapshot）============
const MAX_TURNS = 8;

export async function runEventedToolLoop(
  state: AgentState,
  provider: Provider,
  registry: ToolRegistry,
  hooks: ToolHooks,
  snapshot: TurnSnapshot,
  output: Output,
): Promise<AssistantMessage> {
  let turns = 0;
  while (true) {
    turns += 1;
    if (turns > MAX_TURNS) {
      const stopped: AssistantMessage = {
        role: "assistant", content: "(达到最大轮次，停止)", stopReason: "stop",
      };
      state.messages.push(stopped);
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
        state.messages.push(resultMessage);
        output.log(`tool_result: ${resultMessage.content}`);
      } else if (event.type === "message_end") { stopReason = event.stopReason; output.log(`message_end: ${stopReason}`); }
    }
    if (!sawToolCall || stopReason !== "toolUse") {
      const assistant: AssistantMessage = { role: "assistant", content, stopReason };
      state.messages.push(assistant);
      return assistant;
    }
  }
}

// ============ Demo Provider（fake）============
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

    yield {
      type: "tool_call",
      call: { id: "call_1", name: "current_time", input: {} },
    };
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

function createHooks(output: Output): ToolHooks {
  return {
    beforeToolCall(call) {
      output.log(`[beforeToolCall] allow: ${call.name}`);
      return { type: "allow" };
    },
    afterToolCall(call, result) {
      output.log(`[afterToolCall] ${call.name} -> ${result}`);
      return result;
    },
  };
}

function printAssistantMessage(output: Output, message: AssistantMessage): void {
  output.log("[assistant]");
  output.log(`content: ${message.content}`);
  output.log(`stopReason: ${message.stopReason}`);
  output.log("");
}

async function main(): Promise<void> {
  const output = createConsoleOutput();
  const state = createInitialState("demo-small");
  const registry = createRegistry();
  const hooks = createHooks(output);
  const provider = new DemoProvider();

  output.log("s06: Turn Snapshot");
  output.log("");

  // 1) 一轮开始：push 用户消息，拍快照（此刻 registry 只有 current_time）。
  state.messages.push(createUserMessage("现在几点？"));
  const snapshot = createTurnSnapshot(state, registry);

  // 2) 拍完之后，外部又往 registry 加了一个工具。
  registry.register({
    spec: { name: "echo", description: "原样返回输入", input: { text: "文本" } },
    handler: (input) => input.text ?? "(空)",
  });

  // 3) 验证固定性：快照没变，但 registry 已经多了工具；model 在 state（跨轮），不进快照。
  output.log("[snapshot 固定性]");
  output.log(`snapshot.tools: ${snapshotToolsCount(snapshot)}`);
  output.log(`registry 现在: ${registry.count()}`);
  output.log(`state.model: ${state.model}（跨轮配置，不在 snapshot）`);
  output.log("");

  output.log("[user]");
  output.log("现在几点？");
  output.log("");

  // 4) 跑循环：本轮 tools 用 snapshot 的（仍只有 current_time），不含后加的 echo。
  const assistant = await runEventedToolLoop(
    state,
    provider,
    registry,
    hooks,
    snapshot,
    output,
  );
  output.log("");

  printAssistantMessage(output, assistant);

  output.log("[provider 看到的 tools]");
  output.log(`tools: ${provider.lastInput?.tools.length ?? 0}`);
  output.log("");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
