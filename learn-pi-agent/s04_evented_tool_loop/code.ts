// s04: Evented Tool Loop — mini Pi 的第 4 版
//
// [U1 升级] runOneTurn → runEventedToolLoop：provider 请求工具，core 执行后把结果送回，循环到 provider 不再请求为止。
// 词汇边界：本章新增 ToolCall / ToolResultMessage / tool_call / toolUse / runEventedToolLoop / run。
// 关键：tools 取 registry.getSpecs()（单一数据源，不硬编码）；循环有上限（R5）；工具出错不崩（R4）。

declare const process: {
  exitCode?: number;
};

// —— 停止原因（R1：s04 加 toolUse）——
export type StopReason = "stop" | "toolUse" | "error";

// —— s01 起：消息 ——
export type UserMessage = {
  role: "user";
  content: string;
};

export type AssistantMessage = {
  role: "assistant";
  content: string;
  stopReason: StopReason;
};

// s04 新增：工具执行结果也是一种消息，和 user / assistant 平级。
export type ToolResultMessage = {
  role: "toolResult";
  toolCallId: string;
  content: string;
};

// s04 起：AgentMessage 并入 ToolResultMessage（R1 只增）
export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;

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

// s04 新增：provider 对一个工具的调用请求。
export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, string>;
};

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

  // s04 新增：执行工具。未知工具不崩，返回一句说明。
  run(call: ToolCall): string {
    const tool = this.tools.get(call.name);
    if (!tool) {
      return `unknown tool: ${call.name}`;
    }
    return tool.handler(call.input);
  }
}

// —— provider 对外消息（s04：加 toolResult 形态）——
export type ProviderMessage =
  | { role: "user" | "assistant"; content: string }
  | { role: "toolResult"; toolCallId: string; content: string };

// provider 输入（R1 只增）
export type ProviderInput = {
  messages: ProviderMessage[];
  tools: ToolSpec[];
};

// —— s03 起：事件流（s04 加 tool_call，保留 message_start，R1）——
export type ProviderEvent =
  | { type: "message_start" }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "message_end"; stopReason: StopReason };

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

// s04：buildProviderInput 要把 toolResult 消息也正确转给 provider。
export function buildProviderInput(
  state: AgentState,
  registry: ToolRegistry,
): ProviderInput {
  return {
    messages: state.messages.map((message) => {
      if (message.role === "toolResult") {
        return {
          role: "toolResult",
          toolCallId: message.toolCallId,
          content: message.content,
        };
      }
      return { role: message.role, content: message.content };
    }),
    tools: registry.getSpecs(),
  };
}

// ============ s04 [U1]：工具循环（取代 runOneTurn）============
// s03 的 collectAssistantMessage（只攒文本事件）被这里的循环内联收集取代——
// 循环要处理 tool_call，所以收集逻辑直接长在循环里。

// R5：循环必须有上限。否则一个一直请求工具的 provider 会让 core 死循环。
const MAX_TURNS = 8;

export async function runEventedToolLoop(
  state: AgentState,
  provider: Provider,
  registry: ToolRegistry,
  userInput: string,
  output: Output,
): Promise<AssistantMessage> {
  state.messages.push(createUserMessage(userInput));

  let turns = 0;

  while (true) {
    turns += 1;
    if (turns > MAX_TURNS) {
      output.log(`(达到最大轮次 ${MAX_TURNS}，停止)`);
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

        // R4：工具执行抛错也不崩，错误变成一条结果消息送回去。
        let result: string;
        try {
          result = registry.run(event.call);
        } catch (error) {
          result = `error: ${error instanceof Error ? error.message : String(error)}`;
        }

        const resultMessage: ToolResultMessage = {
          role: "toolResult",
          toolCallId: event.call.id,
          content: result,
        };
        state.messages.push(resultMessage);
        output.log(`tool_result: ${result}`);
      } else if (event.type === "message_end") {
        stopReason = event.stopReason;
        output.log(`message_end: ${stopReason}`);
      }
    }

    // 没有 tool_call，或 provider 明确不再用工具（stopReason 不是 toolUse），就结束。
    if (!sawToolCall || stopReason !== "toolUse") {
      const assistant: AssistantMessage = { role: "assistant", content, stopReason };
      state.messages.push(assistant);
      return assistant;
    }
  }
}

// ============ Demo Provider（fake）============
// 演示一个完整的工具循环：第一轮请求工具，第二轮收到结果后输出文本并结束。
export class DemoProvider implements Provider {
  public lastInput: ProviderInput | undefined;

  async *stream(input: ProviderInput): AsyncGenerator<ProviderEvent> {
    this.lastInput = input;
    const last = input.messages[input.messages.length - 1];

    yield { type: "message_start" };

    if (last?.role === "toolResult") {
      // 工具结果回来了：输出文本，正常结束。
      yield { type: "text_delta", text: `工具结果是：${last.content}` };
      yield { type: "message_end", stopReason: "stop" };
      return;
    }

    // 否则请求调用一个工具。
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

function printState(output: Output, state: AgentState): void {
  output.log("[state]");
  output.log(state.messages.map((message) => message.role).join(" -> "));
  output.log("");
}

async function main(): Promise<void> {
  const output = createConsoleOutput();
  const state = createInitialState();
  const registry = createRegistry();
  const provider = new DemoProvider();

  output.log("s04: Evented Tool Loop");
  output.log("");

  output.log("[user]");
  output.log("现在几点？");
  output.log("");

  const assistant = await runEventedToolLoop(
    state,
    provider,
    registry,
    "现在几点？",
    output,
  );
  output.log("");

  printAssistantMessage(output, assistant);
  printState(output, state);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
