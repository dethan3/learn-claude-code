// s07: Session Tree — mini Pi 的第 7 版
//
// [U1 受控升级] AgentState.messages 从数组升级为 SessionTree：历史能分叉，一轮输入取当前路径。
// 词汇边界：本章新增 SessionTree / SessionEntry / parentId / moveTo / currentPath / append / activeLeaf。
// 关键：currentPath() 仍产出线性 AgentMessage[]，ProviderInput 的构造方式不变；id 计数器是实例级（不跨实例累加）。

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

// ============ s07 新增 [U1]：会话历史从数组变成树 ============

// 一个节点 = 一条消息 + 它在树里的位置。
export type SessionEntry = {
  id: string;
  parentId: string | null;
  message: AgentMessage;
};

export class SessionTree {
  private entries = new Map<string, SessionEntry>();
  private activeLeafId: string | null = null;
  private counter = 0; // 实例级：每个 SessionTree 独立计数，不跨实例累加

  append(message: AgentMessage): SessionEntry {
    const entry: SessionEntry = {
      id: `e${++this.counter}`,
      parentId: this.activeLeafId,
      message,
    };
    this.entries.set(entry.id, entry);
    this.activeLeafId = entry.id;
    return entry;
  }

  // 切换当前位置到某个已有节点（分叉的起点）。不存在的 id 会抛错。
  moveTo(entryId: string): void {
    if (!this.entries.has(entryId)) {
      throw new Error(`unknown entry: ${entryId}`);
    }
    this.activeLeafId = entryId;
  }

  // 从当前位置回溯到根，产出一条线性的消息序列。ProviderInput 就用它。
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

  allEntries(): SessionEntry[] {
    return [...this.entries.values()];
  }
}

// [U1] core 内部状态：messages 数组 → SessionTree；model 跨轮配置（对齐 Pi AgentState）。
export type AgentState = {
  session: SessionTree;
  model: string;
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

// —— provider 对外 ——
export type ProviderMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "toolResult"; toolCallId: string; content: string };

// 对齐 Pi Context：messages + tools。model 在 AgentState，不进 ProviderInput。
export type ProviderInput = {
  messages: ProviderMessage[];
  tools: ToolSpec[];
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
  try {
    result = registry.run(call);
  } catch (error) {
    result = `error: ${error instanceof Error ? error.message : String(error)}`;
  }
  const finalResult = hooks.afterToolCall?.(call, result) ?? result;
  return { role: "toolResult", toolCallId: call.id, content: finalResult };
}

// —— s06 起：一轮快照（对齐 Pi AgentContext：固定 messages/tools；model 在 state 不进快照）——
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

// s07：messages 从 state.session.currentPath() 取（线性投影当前路径）。
export function createTurnSnapshot(
  state: AgentState,
  registry: ToolRegistry,
): TurnSnapshot {
  return {
    messages: toProviderMessages(state.session.currentPath()),
    tools: registry.getSpecs(),
  };
}

export function buildProviderInputFromSnapshot(
  snapshot: TurnSnapshot,
  state: AgentState,
): ProviderInput {
  return {
    messages: toProviderMessages(state.session.currentPath()),
    tools: snapshot.tools,
  };
}

// ============ 构造函数 ============
export function createInitialState(model = "demo-small"): AgentState {
  return { session: new SessionTree(), model };
}

export function createUserMessage(content: string): UserMessage {
  return { role: "user", content };
}

// ============ 工具循环（s07：用 state.session）============
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
        role: "assistant",
        content: "(达到最大轮次，停止)",
        stopReason: "stop",
      };
      state.session.append(stopped);
      return stopped;
    }

    const providerInput = buildProviderInputFromSnapshot(snapshot, state);
    let content = "";
    let stopReason: StopReason = "stop";
    let sawToolCall = false;

    for await (const event of provider.stream(providerInput)) {
      if (event.type === "message_start") {
        output.log("message_start");
      } else if (event.type === "text_delta") {
        output.log(`text_delta: ${event.text}`);
        content += event.text;
      } else if (event.type === "tool_call") {
        sawToolCall = true;
        output.log(`tool_call: ${event.call.name}`);
        const resultMessage = executeToolCall(registry, hooks, event.call);
        state.session.append(resultMessage);
        output.log(`tool_result: ${resultMessage.content}`);
      } else if (event.type === "message_end") {
        stopReason = event.stopReason;
        output.log(`message_end: ${stopReason}`);
      }
    }

    if (!sawToolCall || stopReason !== "toolUse") {
      const assistant: AssistantMessage = { role: "assistant", content, stopReason };
      state.session.append(assistant);
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

// ============ 演示脚手架：演示历史分叉 ============

function printPath(output: Output, title: string, path: AgentMessage[]): void {
  output.log(title);
  for (const message of path) {
    output.log(`${message.role}: ${message.content}`);
  }
  output.log("");
}

async function main(): Promise<void> {
  const output = createConsoleOutput();
  const state = createInitialState();

  output.log("s07: Session Tree");
  output.log("");

  // 第一条线：方案 A
  const first = state.session.append(createUserMessage("方案 A"));
  state.session.append({
    role: "assistant",
    content: "A 的回答",
    stopReason: "stop",
  });

  printPath(output, "[路径：方案 A]", state.session.currentPath());

  // 回到第一个节点，从那里分叉出方案 B
  state.session.moveTo(first.id);
  state.session.append({
    role: "assistant",
    content: "改走方案 B",
    stopReason: "stop",
  });

  printPath(output, "[路径：方案 B]", state.session.currentPath());

  // 树的全貌
  output.log("[所有节点]");
  for (const entry of state.session.allEntries()) {
    output.log(
      `${entry.id} parent=${entry.parentId ?? "null"} ${entry.message.role}: ${entry.message.content}`,
    );
  }
  output.log("");
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
