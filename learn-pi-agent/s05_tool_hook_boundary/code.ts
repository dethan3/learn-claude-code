// s05: Tool Hook Boundary — mini Pi 的第 5 版
//
// 在工具执行的前后各留一个插口：执行前可以拦，执行后可以改结果。
// 词汇边界：本章新增 beforeToolCall / afterToolCall / ToolHooks / BeforeToolCallResult / executeToolCall / allow / block。
// 关键：hook 是外层装饰，ToolRegistry 本身不变（R2）；执行+错误捕获收口到 executeToolCall。

declare const process: {
  argv: string[];
  exitCode?: number;
};

// —— 停止原因（s04 起）——
export type StopReason = "stop" | "toolUse" | "error";

// —— 消息（s01 起 + s04 的 ToolResultMessage）——
export type UserMessage = { role: "user"; content: string };
export type AssistantMessage = { role: "assistant"; content: string; stopReason: StopReason };
export type ToolResultMessage = { role: "toolResult"; toolCallId: string; content: string };
export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

export type AgentState = { messages: AgentMessage[] };

// —— 工具契约（s02 起）——
export type ToolSpec = { name: string; description: string; input: Record<string, string> };
export type ToolHandler = (input: Record<string, string>) => string;
export type ToolCall = { id: string; name: string; input: Record<string, string> };
export type Tool = { spec: ToolSpec; handler: ToolHandler };

export class ToolRegistry {
  private tools = new Map<string, Tool>();
  register(tool: Tool): void { this.tools.set(tool.spec.name, tool); }
  getSpecs(): ToolSpec[] { return [...this.tools.values()].map((tool) => tool.spec); }
  run(call: ToolCall): string {
    const tool = this.tools.get(call.name);
    if (!tool) return `unknown tool: ${call.name}`;
    return tool.handler(call.input);
  }
}

// —— provider 对外（s04 起）——
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

// ============ s05 新增：执行前后的两个插口 ============

export type BeforeToolCallResult =
  | { type: "allow" }
  | { type: "block"; reason: string };

export type ToolHooks = {
  beforeToolCall?: (call: ToolCall) => BeforeToolCallResult;
  afterToolCall?: (call: ToolCall, result: string) => string;
};

// 把一次工具执行串成 before → run → after 三段。
// before 可以拦下（block），after 可以改写结果。中间的 run 仍是 s04 的 registry.run。
// 工具抛错也在这里收口（R4），不向上抛。
export function executeToolCall(
  registry: ToolRegistry,
  hooks: ToolHooks,
  call: ToolCall,
): ToolResultMessage {
  const before = hooks.beforeToolCall?.(call) ?? { type: "allow" };

  if (before.type === "block") {
    return {
      role: "toolResult",
      toolCallId: call.id,
      content: `blocked: ${before.reason}`,
    };
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

// ============ 构造函数 ============
export function createInitialState(): AgentState { return { messages: [] }; }
export function createUserMessage(content: string): UserMessage { return { role: "user", content }; }

export function buildProviderInput(state: AgentState, registry: ToolRegistry): ProviderInput {
  return {
    messages: state.messages.map((message) => {
      if (message.role === "toolResult") {
        return { role: "toolResult", toolCallId: message.toolCallId, content: message.content };
      }
      return { role: message.role, content: message.content };
    }),
    tools: registry.getSpecs(),
  };
}

// ============ 工具循环（s04 起。s05：加 hooks，tool_call 走 executeToolCall）============
const MAX_TURNS = 8;

export async function runEventedToolLoop(
  state: AgentState,
  provider: Provider,
  registry: ToolRegistry,
  hooks: ToolHooks,
  userInput: string,
  output: Output,
): Promise<AssistantMessage> {
  state.messages.push(createUserMessage(userInput));

  let turns = 0;

  while (true) {
    turns += 1;
    if (turns > MAX_TURNS) {
      const stopped: AssistantMessage = {
        role: "assistant",
        content: "(达到最大轮次，停止)",
        stopReason: "stop",
      };
      state.messages.push(stopped);
      return stopped;
    }

    const providerInput = buildProviderInput(state, registry);
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
        // s05：执行交给 executeToolCall，hook 在里面跑。
        const resultMessage = executeToolCall(registry, hooks, event.call);
        state.messages.push(resultMessage);
        output.log(`tool_result: ${resultMessage.content}`);
      } else if (event.type === "message_end") {
        stopReason = event.stopReason;
        output.log(`message_end: ${stopReason}`);
      }
    }

    if (!sawToolCall || stopReason !== "toolUse") {
      const assistant: AssistantMessage = { role: "assistant", content, stopReason };
      state.messages.push(assistant);
      return assistant;
    }
  }
}

// ============ Demo Provider（fake）============
// 按传入的工具名发请求，演示 allow 和 block 两种路径。
export class DemoProvider implements Provider {
  public lastInput: ProviderInput | undefined;
  constructor(private requestedTool: string) {}

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
      call: { id: "call_1", name: this.requestedTool, input: { text: "hi" } },
    };
    yield { type: "message_end", stopReason: "toolUse" };
  }
}

// ============ 演示脚手架 ============

function createRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register({
    spec: { name: "echo", description: "原样返回输入", input: { text: "要复读的文本" } },
    handler: (input) => input.text ?? "(空)",
  });
  registry.register({
    spec: { name: "dangerous", description: "一个被禁用的演示工具", input: {} },
    handler: () => "不该执行到这里",
  });
  return registry;
}

function createHooks(output: Output): ToolHooks {
  return {
    beforeToolCall(call) {
      output.log("[beforeToolCall]");
      if (call.name === "dangerous") {
        output.log(`block: ${call.name}`);
        return { type: "block", reason: "这个工具在演示里被禁用" };
      }
      output.log(`allow: ${call.name}`);
      return { type: "allow" };
    },
    afterToolCall(call, result) {
      output.log("[afterToolCall]");
      output.log(`${call.name} -> ${result}`);
      return `checked: ${result}`;
    },
  };
}

function getCase(): "normal" | "blocked" {
  const index = process.argv.indexOf("--case");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value === "blocked" ? "blocked" : "normal";
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
  const hooks = createHooks(output);

  const caseName = getCase();
  const requestedTool = caseName === "blocked" ? "dangerous" : "echo";
  const userInput = caseName === "blocked" ? "调用危险工具" : "复读一下 hi";
  const provider = new DemoProvider(requestedTool);

  output.log("s05: Tool Hook Boundary");
  output.log("");

  output.log("[user]");
  output.log(userInput);
  output.log("");

  const assistant = await runEventedToolLoop(
    state,
    provider,
    registry,
    hooks,
    userInput,
    output,
  );
  output.log("");

  printAssistantMessage(output, assistant);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
