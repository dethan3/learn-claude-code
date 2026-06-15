# s04: Evented Tool Loop — 请求、执行、送回去

> *provider 点菜，core 后厨，结果回桌。*
> **Pi 边界**：工具执行边界 —— provider 只发请求，执行永远在 core；结果回到消息流，成为历史。

[上一节：s03](../s03_provider_event_stream/) → `s04` → [下一节：s05](../s05_tool_hook_boundary/)

---

## 问题

s02 给了 provider 工具说明，s03 给了事件流。但到现在为止，provider 还不能**真的用上**这些工具——它只会说文本，没法告诉 core"去把那个工具跑一下"。

而且就算能请求，往往也不是一趟就够：provider 用完一个工具，看了结果，可能还要再用一个。这需要一个来回多次的循环。

s04 要补上这一环：让 provider 能**请求**执行工具，core 执行后把结果**送回去**，循环到 provider 不再请求为止。

---

## 解决方案

事件里多出一种 `tool_call`：provider 用它说"我要调用某个工具"。core 收到后做三步：

```text
tool_call  →  registry.run()  →  ToolResultMessage  →  进 messages
```

工具结果和 user / assistant 消息**平级**，也存进 messages。这样 provider 下一轮就能看到"刚才那个工具返回了什么"，决定是接着用工具，还是收尾。

> **[U1 升级]** 一轮推进的函数从 `runOneTurn` 变成 `runEventedToolLoop`：原来跑一趟就结束，现在套了一个循环。这是受控升级——单轮没法表达"来回多趟"，所以是替换。

这一节还顺手立两条保护：循环有**轮次上限**，provider 一直请求也不会死循环（R5）；工具执行**抛错也不崩**，错误会被包成一条结果消息送回去（R4）。

---

## 工作原理

**先定义请求和结果。** provider 的请求叫 ToolCall，结果叫 ToolResultMessage。

```ts
export type ToolCall = {
  id: string;
  name: string;
  input: Record<string, string>;
};

export type ToolResultMessage = {
  role: "toolResult";
  toolCallId: string;
  content: string;
};
```

工具结果也是一种消息，并入 AgentMessage；停止原因也多一个 `toolUse`，表示"provider 还想用工具，先别停"。

```ts
export type StopReason = "stop" | "toolUse" | "error";
export type AgentMessage = UserMessage | AssistantMessage | ToolResultMessage;
```

**事件里加 tool_call。** s03 的三种事件都在，多出来的是 `tool_call`。

```ts
export type ProviderEvent =
  | { type: "message_start" }
  | { type: "text_delta"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "message_end"; stopReason: StopReason };
```

**registry 学会执行。** `run(call)` 拿到工具就跑 handler；碰到没注册过的名字，不抛错，返回一句说明。

```ts
run(call: ToolCall): string {
  const tool = this.tools.get(call.name);
  if (!tool) {
    return `unknown tool: ${call.name}`;
  }
  return tool.handler(call.input);
}
```

**核心是循环。** `runEventedToolLoop` 每一轮：构造输入 → 收事件 → 遇到 tool_call 就执行、把结果存成消息 → 一轮事件收完后，看还有没有 tool_call。有就再来一轮，没有就收尾。轮次超过上限会主动停下。

```ts
while (true) {
  turns += 1;
  if (turns > MAX_TURNS) { /* 主动停止 */ }

  // ... 收事件，遇 tool_call 就 registry.run + 存 ToolResultMessage ...

  if (!sawToolCall || stopReason !== "toolUse") {
    // 存下 assistant 消息，结束
    return assistant;
  }
}
```

工具执行包在 try/catch 里：handler 抛错，错误变成 `error: ...` 这条结果消息，循环继续——provider 会看到这个错误，自己决定怎么办。

> 这一节真正建立的是**工具执行边界**：provider 只发请求，执行永远发生在 core 这边；而且工具结果不丢，它回到消息流里，成为对话历史的一部分。后面 s05 会在"执行"这个动作的前后加插口，但"请求在 provider、执行在 core"这条分隔，从这里立起来。

---

## 试一下

运行：

```sh
npm run s04
```

输出类似：

```text
s04: Evented Tool Loop

[user]
现在几点？

message_start
tool_call: current_time
tool_result: 2026-01-01T00:00:00Z
message_end: toolUse
message_start
text_delta: 工具结果是：2026-01-01T00:00:00Z
message_end: stop

[assistant]
content: 工具结果是：2026-01-01T00:00:00Z
stopReason: stop

[state]
user -> toolResult -> assistant
```

观察重点：第一轮 provider 请求 `current_time`，core 执行后结果进了 messages（`tool_result`）；第二轮 provider 看到结果，输出文本并结束；`[state]` 里能看到 `user -> toolResult -> assistant` 这条链。

---

## 接入主线

s04 在 s03 上累积。相对 s03 的变更：

| 组件 | s03 | s04 |
| --- | --- | --- |
| `StopReason` | `stop \| error` | `stop \| toolUse \| error`（R1 加 toolUse） |
| `AgentMessage` | `User \| Assistant` | `User \| Assistant \| ToolResultMessage`（R1） |
| 新增类型 | — | `ToolCall` / `ToolResultMessage` |
| `ProviderEvent` | 三种 | 加 `tool_call`（R1：message_start 保留） |
| `ToolRegistry` | `register / getSpecs` | 加 `run(call)`（R2） |
| 一轮推进 | `runOneTurn`（单趟） | **`runEventedToolLoop`**（U1 升级，带循环） |
| 事件收集 | `collectAssistantMessage`（单函数） | 被循环内联收集取代（要处理 tool_call） |
| 保护 | — | `MAX_TURNS` 终止（R5）、工具错误捕获（R4） |

**焊接点**：循环内 `tool_call` → `registry.run(call)` → 结果存成 ToolResultMessage 进 messages → 下一轮 provider 输入；tools 始终取 `registry.getSpecs()`，和能执行的工具是同一份来源。

---

## 接下来

现在 provider 一请求，工具就直接执行了——没有给 core 留任何介入的余地。

下一节会在执行这个动作的前后留两个插口：执行前可以拦下来，执行后可以改写结果。

进入下一节：[s05](../s05_tool_hook_boundary/)。

---

<details>
<summary>Pi 源码溯源：工具循环的并发与终止</summary>

教学版的 `runEventedToolLoop` 是串行循环、`MAX_TURNS` 兜底。Pi 的工具循环（`packages/agent`）要复杂得多——最关键的是**并发执行**。

### 源码在哪

- `packages/agent/src/agent-loop.ts:373` — `executeToolCalls`（工具执行总入口）
- `packages/agent/src/agent-loop.ts:451` — `executeToolCallsParallel`（并发执行）
- `packages/agent/src/types.ts:29` — `ToolExecutionMode`

### 一个 stop 可以带多个工具调用

教学版一轮只处理一个 `tool_call`。Pi 里模型一次回复可以带**多个** tool call（`agent-loop.ts:207`）：

```ts
if (toolCalls.length > 0) {
  const batch = await executeToolCalls(currentContext, message, config, signal, emit);
  toolResults.push(...batch.messages);
  hasMoreToolCalls = !batch.terminate;
}
```

一次 batch 里所有工具一起处理，结果一起回写。

### sequential vs parallel

教学版串行。Pi 有两种执行模式（`types.ts:29`）：

```ts
type ToolExecutionMode = "sequential" | "parallel";
```

并发版 `executeToolCallsParallel`（`agent-loop.ts:451`）用 `Promise.all` 同时跑多个工具，但**事件顺序保持**——prepare 阶段（参数校验 + beforeHook，s05）是顺序的，execute 阶段才并发，结果按完成时间发事件。哪个工具该并发、哪个该独占，由工具自己的 `executionMode` 决定（s02 提过 AgentTool 有这个字段）。

### 工具能主动终止整个循环

教学版的终止条件是"provider 不再发 tool_call"或"撞 MAX_TURNS"。Pi 多一个：工具结果能带 `terminate`（`types.ts`）：

```ts
interface AgentToolResult<T> {
  content: (TextContent | ImageContent)[];
  details: T;
  terminate?: boolean;   // 这个工具要求停止整个 agent
}
```

只有 batch 里**所有**工具都 `terminate` 才真停——防止单个工具误杀整个会话。教学版的 MAX_TURNS 是被动兜底，Pi 的 terminate 是工具主动喊停。

### 执行前后有插口（s05 的预告）

教学版直接 `registry.run`。Pi 的每个工具执行经过 `prepareToolCall`（参数校验 + beforeToolCall hook）→ `execute` → `finalizeExecutedToolCall`（afterToolCall hook）。这就是 s05 的 hook 真实位置——它长在并发执行的 prepare/finalize 两侧。

### 一句话

教学版的循环立的是"请求 → 执行 → 回写 → 再来"。Pi 把它扩成 batch 并发 + 工具主动 terminate + 执行前后插口，但循环主干（收 tool_call、执行、结果回 messages、看是否继续）和教学版一致。

</details>
