// s02: Tool Contract — mini Pi 的第 2 版
//
// 在 s01 上累积：core 手里的本地能力，先变成 provider 能读的说明。
// 工具拆成两层——spec 给 provider 看，handler 留在本地。本节不执行工具（执行是 s04）。
// 词汇边界：本章新增 Tool / ToolSpec / ToolHandler / ToolRegistry / register / getSpecs / tools。

declare const process: {
  exitCode?: number;
};

// —— 停止原因（R1 只增。s01 起，s04 加 toolUse）——
export type StopReason = "stop" | "error";

// —— 消息三类型（s01 起，union 只增）——
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

// —— core 内部状态（s01 起。s07 升级为 SessionTree）——
export type AgentState = {
  messages: AgentMessage[];
};

// ============ s02 新增：工具契约 ============

// 工具说明：给 provider 看的那一层。只描述能力，不含可执行代码。
export type ToolSpec = {
  name: string;
  description: string;
  input: Record<string, string>; // 参数说明；立下来就不再删（R1）
};

// 本地执行函数：留在 core 这一层，provider 看不到。
export type ToolHandler = (input: Record<string, string>) => string;

// 一个完整工具 = 说明 + 执行。两层在 Tool 里合起来，但只有 spec 会离开 core。
export type Tool = {
  spec: ToolSpec;
  handler: ToolHandler;
};

// 工具登记表：core 持有完整工具（spec + handler）。
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.spec.name, tool);
  }

  // 只交出说明，不交出 handler。
  getSpecs(): ToolSpec[] {
    return [...this.tools.values()].map((tool) => tool.spec);
  }

  // s04 会在这里加 run(call)：真正执行 handler。
}

// ============ provider 对外形态（s01 起）============

export type ProviderMessage = {
  role: "user" | "assistant";
  content: string;
};

// provider 输入（R1 字段只增）：s01 的 messages + s02 新增的 tools。
export type ProviderInput = {
  messages: ProviderMessage[];
  tools: ToolSpec[]; // s02 新增；s06 加 modelName、s08 加 context
};

// provider 调用边界（s01 起。s03 升级为 stream）
export interface Provider {
  complete(input: ProviderInput): Promise<AssistantMessage>;
}

// 输出抽象（R7。s01 起，s10 升级为 RuntimeMode）
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

// s02 起：buildProviderInput 多接收 registry，把工具说明一起交给 provider。
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

// ============ 一轮推进 ============

// s02 起：runOneTurn 多接收 registry。
export async function runOneTurn(
  state: AgentState,
  provider: Provider,
  registry: ToolRegistry,
  userInput: string,
): Promise<AssistantMessage> {
  state.messages.push(createUserMessage(userInput));

  const providerInput = buildProviderInput(state, registry);
  const assistantMessage = await provider.complete(providerInput);

  state.messages.push(assistantMessage);
  return assistantMessage;
}

// ============ Demo Provider（fake）============

export class DemoProvider implements Provider {
  public lastInput: ProviderInput | undefined;

  async complete(input: ProviderInput): Promise<AssistantMessage> {
    this.lastInput = input;

    const names = input.tools.map((tool) => tool.name).join(", ");

    return {
      role: "assistant",
      content: `我看到 ${input.tools.length} 个工具：${names}`,
      stopReason: "stop",
    };
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

function printProviderInput(output: Output, input: ProviderInput | undefined): void {
  output.log("[provider input]");

  if (!input) {
    output.log("messages: 0");
    output.log("tools: 0");
    output.log("");
    return;
  }

  output.log(`messages: ${input.messages.length}`);
  output.log(`tools: ${input.tools.length}`);

  for (const tool of input.tools) {
    output.log(`- ${tool.name}: ${tool.description}`);
  }

  output.log("");
}

function printAssistantMessage(output: Output, message: AssistantMessage): void {
  output.log("[assistant]");
  output.log(`content: ${message.content}`);
  output.log(`stopReason: ${message.stopReason}`);
  output.log("");
}

async function main(): Promise<void> {
  const output = createConsoleOutput();
  const state = createInitialState();
  const registry = createRegistry();
  const provider = new DemoProvider();

  output.log("s02: Tool Contract");
  output.log("");

  output.log("[tools registered]");
  for (const spec of registry.getSpecs()) {
    output.log(`${spec.name}: ${spec.description}`);
  }
  output.log("");

  const assistant = await runOneTurn(
    state,
    provider,
    registry,
    "我有哪些本地能力？",
  );

  printProviderInput(output, provider.lastInput);
  printAssistantMessage(output, assistant);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
