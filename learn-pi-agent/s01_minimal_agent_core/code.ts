// s01: Agent Core — mini Pi 的第 1 版（地基）
//
// 本节只做一件事：core 保存一轮对话，provider 接收 ProviderInput 返回 AssistantMessage。
// 后续 11 节都在这份代码上累积（宪法 R8：每节 code.ts 是前一节的超集）。
// 词汇边界：本章只用 AgentState / AgentMessage / UserMessage / AssistantMessage /
//           Provider / ProviderInput / ProviderMessage / StopReason / runOneTurn / complete / Output。

declare const process: {
  argv: string[];
  exitCode?: number;
};

// —— 停止原因（宪法 R1：取值只增。s04 会加入 "toolUse"）——
export type StopReason = "stop" | "error";

// —— 消息三类型（AgentMessage union 只增，R1）——
export type UserMessage = {
  role: "user";
  content: string;
};

export type AssistantMessage = {
  role: "assistant";
  content: string;
  stopReason: StopReason; // stopReason 永驻：后续章节不会把它删掉
};

export type AgentMessage = UserMessage | AssistantMessage;

// —— core 内部状态 ——
export type AgentState = {
  messages: AgentMessage[]; // s07 会把这里升级为 SessionTree（U1 受控升级）
};

// —— provider 对外看到的消息形态 ——
export type ProviderMessage = {
  role: "user" | "assistant";
  content: string;
};

// —— provider 本轮输入（字段只增，R1：s02 加 tools、s06 加 modelName、s08 加 context）——
export type ProviderInput = {
  messages: ProviderMessage[];
};

// —— provider 调用边界（s03 会由 complete 升级为 stream，U1 受控升级）——
export interface Provider {
  complete(input: ProviderInput): Promise<AssistantMessage>;
}

// —— 输出抽象（宪法 R7：core 不直接决定输出形式）——
// s01 只用最简单的一层间接。s10 会把它升级为 RuntimeMode（PrintMode / JsonMode）。
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

// 这一步看起来很薄，但它划出第一条边界：core 内部状态与 provider 输入分开。
export function buildProviderInput(state: AgentState): ProviderInput {
  return {
    messages: state.messages.map((message) => ({
      role: message.role,
      content: message.content,
    })),
  };
}

// ============ 一轮推进 ============

export async function runOneTurn(
  state: AgentState,
  provider: Provider,
  userInput: string,
): Promise<AssistantMessage> {
  const userMessage = createUserMessage(userInput);
  state.messages.push(userMessage);

  const providerInput = buildProviderInput(state);
  const assistantMessage = await provider.complete(providerInput);

  state.messages.push(assistantMessage);
  return assistantMessage;
}

// ============ Demo Provider（fake，不依赖真实模型 API）============

export class DemoProvider implements Provider {
  public lastInput: ProviderInput | undefined;

  async complete(input: ProviderInput): Promise<AssistantMessage> {
    this.lastInput = input;

    const lastMessage = input.messages[input.messages.length - 1];

    if (!lastMessage || lastMessage.role !== "user") {
      return {
        role: "assistant",
        content: "Provider could not complete this turn.",
        stopReason: "error",
      };
    }

    if (lastMessage.content.includes("触发错误")) {
      return {
        role: "assistant",
        content: "Provider could not complete this turn.",
        stopReason: "error",
      };
    }

    return {
      role: "assistant",
      content: `收到：${lastMessage.content}`,
      stopReason: "stop",
    };
  }
}

// ============ 演示脚手架（观察用，不属于 core）============

type DemoCase = "normal" | "error";

function getDemoCase(): DemoCase {
  const caseIndex = process.argv.indexOf("--case");
  const value = caseIndex >= 0 ? process.argv[caseIndex + 1] : undefined;
  return value === "error" ? "error" : "normal";
}

function getUserInput(demoCase: DemoCase): string {
  return demoCase === "error" ? "触发错误" : "你好，mini Pi";
}

function printProviderInput(
  output: Output,
  input: ProviderInput | undefined,
): void {
  output.log("[provider input]");

  if (!input) {
    output.log("messages: 0");
    output.log("");
    return;
  }

  const lastMessage = input.messages[input.messages.length - 1];

  output.log(`messages: ${input.messages.length}`);

  if (lastMessage) {
    output.log(`last.role: ${lastMessage.role}`);
    output.log(`last.content: ${lastMessage.content}`);
  }

  output.log("");
}

function printAssistantMessage(output: Output, message: AssistantMessage): void {
  output.log("[assistant]");
  output.log(`content: ${message.content}`);
  output.log(`stopReason: ${message.stopReason}`);
  output.log("");
}

function printState(output: Output, state: AgentState): void {
  const lastMessage = state.messages[state.messages.length - 1];

  output.log("[state]");
  output.log(`messages: ${state.messages.length}`);

  if (lastMessage) {
    output.log(`last.role: ${lastMessage.role}`);

    if (lastMessage.role === "assistant") {
      output.log(`last.stopReason: ${lastMessage.stopReason}`);
    }
  }

  output.log("");
}

async function main(): Promise<void> {
  const output = createConsoleOutput();
  const demoCase = getDemoCase();
  const userInput = getUserInput(demoCase);

  const state = createInitialState();
  const provider = new DemoProvider();

  output.log("s01: Agent Core");
  output.log("");

  output.log("[user]");
  output.log(userInput);
  output.log("");

  const assistantMessage = await runOneTurn(state, provider, userInput);

  printProviderInput(output, provider.lastInput);
  printAssistantMessage(output, assistantMessage);
  printState(output, state);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
