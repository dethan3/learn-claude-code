// s03: Provider Event Stream — mini Pi 的第 3 版
//
// [U1 受控升级] Provider 从 complete（一次性返回）升级为 stream（分段返回事件）。
// 词汇边界：本章新增 ProviderEvent / stream / message_start / text_delta / message_end / collectAssistantMessage。
// 关键：ProviderInput 的 tools 字段保留（R1），不因聚焦事件流而退化。

declare const process: {
  exitCode?: number;
};

// —— s01 起：停止原因 ——
export type StopReason = "stop" | "error";

// —— s01 起：消息三类型 ——
export type UserMessage = {
  role: "user";
  content: string;
};

export type AssistantMessage = {
  role: "assistant";
  content: string;
  stopReason: StopReason;
};

export type AgentMessage = UserMessage | AssistantMessage;

// —— s01 起：core 内部状态 ——
export type AgentState = {
  messages: AgentMessage[];
};

// —— s02 起：工具契约 ——
export type ToolSpec = {
  name: string;
  description: string;
  input: Record<string, string>;
};

export type ToolHandler = (input: Record<string, string>) => string;

export type Tool = {
  spec: ToolSpec;
  handler: ToolHandler;
};

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.spec.name, tool);
  }

  getSpecs(): ToolSpec[] {
    return [...this.tools.values()].map((tool) => tool.spec);
  }
}

// —— s01 起：provider 对外消息 ——
export type ProviderMessage = {
  role: "user" | "assistant";
  content: string;
};

// provider 输入（R1 只增）：messages + tools 都在。
export type ProviderInput = {
  messages: ProviderMessage[];
  tools: ToolSpec[];
};

// ============ s03 新增：provider 输出从"一条消息"变成"一串事件" ============

export type ProviderEvent =
  | { type: "message_start" }
  | { type: "text_delta"; text: string }
  | { type: "message_end"; stopReason: StopReason };
// s04 会在这里加 tool_call（R1：message_start 不会被删）

// [U1 升级] Provider 从 complete 改为 stream。
// provider 的输出形态从"一次性"变成"流式"，两者无法并存，所以这是替换、不是新增。
export interface Provider {
  stream(input: ProviderInput): AsyncGenerator<ProviderEvent>;
}

// —— s01 起：输出抽象（R7）——
export type Output = {
  log(line: string): void;
};

export function createConsoleOutput(): Output {
  return { log: (line) => console.log(line) };
}

// ============ 构造函数 ============

export function createInitialState(): AgentState {
  return { messages: [] };
}

export function createUserMessage(content: string): UserMessage {
  return { role: "user", content };
}

// s02 起
export function buildProviderInput(
  state: AgentState,
  registry: ToolRegistry,
): ProviderInput {
  return {
    messages: state.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
    tools: registry.getSpecs(),
  };
}

// ============ s03 新增：把一串事件攒回一条 assistant 消息 ============

export async function collectAssistantMessage(
  events: AsyncGenerator<ProviderEvent>,
  output: Output,
): Promise<AssistantMessage> {
  let content = "";
  let stopReason: StopReason = "stop";

  for await (const event of events) {
    if (event.type === "message_start") {
      output.log("message_start");
    } else if (event.type === "text_delta") {
      output.log(`text_delta: ${event.text}`);
      content += event.text;
    } else if (event.type === "message_end") {
      stopReason = event.stopReason;
      output.log(`message_end: ${stopReason}`);
    }
  }

  return { role: "assistant", content, stopReason };
}

// ============ 一轮推进 ============

// s03 起：runOneTurn 多接收 output，内部从 complete 改为 stream + collect。
export async function runOneTurn(
  state: AgentState,
  provider: Provider,
  registry: ToolRegistry,
  userInput: string,
  output: Output,
): Promise<AssistantMessage> {
  state.messages.push(createUserMessage(userInput));

  const providerInput = buildProviderInput(state, registry);
  const assistantMessage = await collectAssistantMessage(
    provider.stream(providerInput),
    output,
  );

  state.messages.push(assistantMessage);
  return assistantMessage;
}

// ============ Demo Provider（fake）============

export class DemoProvider implements Provider {
  public lastInput: ProviderInput | undefined;

  async *stream(input: ProviderInput): AsyncGenerator<ProviderEvent> {
    this.lastInput = input;

    const last = input.messages[input.messages.length - 1];

    yield { type: "message_start" };

    if (!last || last.role !== "user") {
      yield { type: "text_delta", text: "Provider could not complete this turn." };
      yield { type: "message_end", stopReason: "error" };
      return;
    }

    yield { type: "text_delta", text: "收到：" };
    yield { type: "text_delta", text: last.content };
    yield { type: "message_end", stopReason: "stop" };
  }
}

// ============ 演示脚手架 ============

function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    spec: {
      name: "read_note",
      description: "读取一条笔记",
      input: { name: "笔记名" },
    },
    handler: (input) => `note:${input.name ?? "unknown"}`,
  });

  registry.register({
    spec: {
      name: "current_time",
      description: "返回一个固定的演示时间",
      input: {},
    },
    handler: () => "2026-01-01T00:00:00Z",
  });

  return registry;
}

function printAssistantMessage(output: Output, message: AssistantMessage): void {
  output.log("[assistant]");
  output.log(`content: ${message.content}`);
  output.log(`stopReason: ${message.stopReason}`);
  output.log("");
}

function printProviderInputSummary(
  output: Output,
  input: ProviderInput | undefined,
): void {
  output.log("[provider input]");
  if (!input) {
    output.log("messages: 0");
    output.log("tools: 0");
    output.log("");
    return;
  }
  output.log(`messages: ${input.messages.length}`);
  output.log(`tools: ${input.tools.length}`);
  output.log("");
}

async function main(): Promise<void> {
  const output = createConsoleOutput();
  const state = createInitialState();
  const registry = createRegistry();
  const provider = new DemoProvider();

  output.log("s03: Provider Event Stream");
  output.log("");

  output.log("[user]");
  output.log("你好，mini Pi");
  output.log("");

  output.log("[events]");
  const assistant = await runOneTurn(
    state,
    provider,
    registry,
    "你好，mini Pi",
    output,
  );
  output.log("");

  printAssistantMessage(output, assistant);

  // 这一行证明：tools 字段还在（R1），没有因为改用事件流而丢掉。
  printProviderInputSummary(output, provider.lastInput);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
