# s03: Provider Event Stream — 结果一段一段回来

> *core 不等整段，而是一段段接。*
> **Pi 边界**：provider 输出边界 —— provider 的输出先变成统一事件，core 再攒回消息。

[上一节：s02](../s02_tool_contract/) → `s03` → [下一节：s04](../s04_evented_tool_loop/)

---

## 问题

前两节里，provider 一次性吐出整段回复，core 只能干等 `complete` 那个 Promise 结束。

这有两个麻烦。一是 core 看不到中间过程——回复很长时，core 没法边收边用。二是不同 provider 返回的东西五花八门，core 要是直接对接每一种，就会被各家差异绑死。

所以 provider 的输出要先变成一种统一的东西：**事件**。core 只认事件，不再关心是哪家 provider。

s03 只做这一件事：把 provider 的返回方式，从"一次性给整段"改成"一段段给事件"。

---

## 解决方案

provider 不再返回完整的 AssistantMessage，而是返回一串事件。这一节用三种：

| 事件 | 含义 |
| --- | --- |
| `message_start` | 一条回复开始了 |
| `text_delta` | 一小段文本 |
| `message_end` | 一条回复结束了，带上停止原因 |

core 这边用一个 `collectAssistantMessage`，把事件重新攒回一条 AssistantMessage。

> **[U1 升级]** Provider 的方法从 `complete` 改成 `stream`。这是宪法允许的受控升级：输出的形态从"一次性"变成"流式"，没法同时存在，所以是替换、不是新增。后面 `stream` 就稳定下来，不再变。

注意一件事：这次升级只动 provider 的**输出**，没动它的**输入**。ProviderInput 里的 messages 和 tools 都还在。

---

## 工作原理

**先定义事件。** 一段回复被拆成三种事件，按顺序到来。

```ts
export type ProviderEvent =
  | { type: "message_start" }
  | { type: "text_delta"; text: string }
  | { type: "message_end"; stopReason: StopReason };
```

**provider 改成产出事件。** `stream` 不再返回一条消息，而是一个挨个 yield 事件的异步生成器。

```ts
export interface Provider {
  stream(input: ProviderInput): AsyncGenerator<ProviderEvent>;
}
```

**core 把事件攒回消息。** `collectAssistantMessage` 一边收事件、一边累加文本，等 `message_end` 到了，停止原因也就拿到了。如果事件流里一个 `message_end` 都没有，停止原因默认是 `stop`——core 不会因为 provider 少发了一个事件就崩掉。

```ts
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
```

**一轮推进换一种接法。** `runOneTurn` 内部从 `provider.complete(...)` 改成 `provider.stream(...)` + `collectAssistantMessage(...)`。对外只是 provider 的返回方式变了，state 还是照样存一条 AssistantMessage。

> 这一节真正建立的是**provider 输出边界**：core 只和事件打交道，provider 内部怎么产生这些事件，是它自己的事。不同 provider 的差异，被事件流这一层吸收掉了。后面 s04 会让事件里多出一种新的类型，但"core 只认事件"这条规矩，从这里立起来。

---

## 试一下

运行：

```sh
npm run s03
```

输出类似：

```text
s03: Provider Event Stream

[user]
你好，mini Pi

[events]
message_start
text_delta: 收到：
text_delta: 你好，mini Pi
message_end: stop

[assistant]
content: 收到：你好，mini Pi
stopReason: stop

[provider input]
messages: 1
tools: 2
```

观察重点：`[events]` 里一段回复被拆成了四个事件；`[assistant]` 是这些事件攒回来的结果；最后一行 `tools: 2` 说明 tools 字段还在，没丢。

---

## 接入主线

s03 在 s02 上累积。相对 s02 的变更：

| 组件 | s02 | s03 |
| --- | --- | --- |
| `Provider` 方法 | `complete`（一次性） | **`stream`**（U1 升级，流式） |
| 新增类型 | — | `ProviderEvent`（`message_start` / `text_delta` / `message_end`） |
| 新增函数 | — | `collectAssistantMessage` |
| `runOneTurn` | `(state, provider, registry, userInput)` | `(state, provider, registry, userInput, output)` |
| `ProviderInput` | `{ messages, tools }` | **不变**（R1：tools 保留） |

**焊接点**：`runOneTurn` 内部 `complete` → `stream` + `collectAssistantMessage`；输入侧（ProviderInput）一字未动。

---

## 接下来

现在事件流里只有文本。

下一节会让事件里多出一种东西——provider 不只是说文本，还会请求 core 去执行一个本地能力。

进入下一节：[s04](../s04_evented_tool_loop/)。

---

<details>
<summary>Pi 源码溯源：多 provider 的统一事件流</summary>

教学版的三种事件（message_start / text_delta / message_end）只覆盖文本。Pi 的 `packages/ai` 把各家 provider 的原始流统一成 **12 种事件**。

### 源码在哪

- `packages/ai/src/types.ts:358` — `AssistantMessageEvent`（事件联合类型）
- `packages/ai/src/types.ts:280` — `StopReason`
- `packages/ai/src/stream.ts:40` — 统一流式入口
- `packages/ai/src/providers/{openai-completions,anthropic,google}.ts` — 各家适配

### 12 种事件

教学版 3 种，Pi 12 种（`types.ts:358`）：

```ts
type AssistantMessageEvent =
  | { type: "start" }
  | { type: "text_start" | "text_delta" | "text_end" }              // 文本
  | { type: "thinking_start" | "thinking_delta" | "thinking_end" }  // 推理过程
  | { type: "toolcall_start" | "toolcall_delta" | "toolcall_end" }  // 工具调用
  | { type: "done"; reason: "stop" | "length" | "toolUse" }
  | { type: "error"; reason: "aborted" | "error" };
```

教学版没有的几类：

- **thinking_delta**：模型的推理过程（chain-of-thought）也是流式的，单独一类。教学版不区分推理和正文。
- **toolcall_start/delta/end**：工具调用本身是分片到达的（参数 JSON 一段段来），不是一次性给齐。教学版 s04 用一个 `tool_call` 表示完整调用，Pi 要先攒碎片。
- **每个事件都带 `partial: AssistantMessage`**：流式过程中每个事件都附上"当前累计的完整消息"，消费方不用自己累加。

### StopReason：5 种，不是 2 种

教学版 `stop | error`。Pi（`types.ts:280`）：

```ts
type StopReason = "stop" | "length" | "toolUse" | "error" | "aborted";
```

- `length`：撞了 max_tokens（教学版没这个概念）。
- `aborted`：用户主动中断（呼应 s01 的 AbortController）。

注意 `done` 和 `error` 是两个顶层终止事件：正常结束发 `done`，出问题发 `error`。教学版把它们都塞进 `message_end` 的 stopReason，Pi 分成两个顶层事件。

### 多 provider 怎么统一

每家 provider 的原始流格式完全不同，Pi 给每家写一个适配器，都产出同一套 `AssistantMessageEvent`：

| provider | 原始流 | 适配文件 | 关键转换 |
| --- | --- | --- | --- |
| OpenAI | `ChatCompletionChunk[]` | `openai-completions.ts:111` | `delta.content → text_delta`，`delta.tool_calls → toolcall_delta` |
| Anthropic | `RawMessageStreamEvent[]` | `anthropic.ts:448` | `content_block_delta.text_delta → text_delta` |
| Google | `GenerateContentResponse[]` | `google.ts:47` | `candidate.content.parts.text → text_delta` |

三家的 `finish_reason` / `stop_reason` 各不相同，各自有 `mapStopReason` 映射到 Pi 的 5 种。这就是教学版 ProviderInput 边界在 provider 侧的对应——core 只认统一事件，provider 差异被适配器吃掉。

### 边界：流中断和空流

OpenAI 适配器（`openai-completions.ts:392`）的收尾逻辑：

```ts
if (options?.signal?.aborted) throw new Error("Request was aborted");
if (output.stopReason === "error") throw new Error(output.errorMessage);
if (!hasFinishReason) throw new Error("Stream ended without finish_reason");
stream.push({ type: "done", reason: output.stopReason, message: output });
```

流中断、provider 报错、没给 finish_reason——三种异常都转成 `error` 事件或异常，消费方（s04 的循环）接住就行。教学版没这层（fake provider 不会失败）。

### 一句话

教学版 3 种事件立的是"provider 输出先变成统一事件"。Pi 把它扩成 12 种事件 + 5 种 stop reason + 三家适配器，把"多 provider 差异"全压在事件流这一层下面——core 永远只和 `AssistantMessageEvent` 打交道。

</details>
