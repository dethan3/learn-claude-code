# s06: Turn Snapshot — 一轮开始，先拍一张

> *开始即冻结：本轮用的东西，后面改了也不算。*
> **Pi 边界**：一轮状态边界 —— 一轮一旦开始，它依赖的配置就定死了，外部怎么变都不影响这一轮。

[上一节：s05](../s05_tool_hook_boundary/) → `s06` → [下一节：s07](../s07_session_tree/)

---

## 问题

前面几节里，每一轮的信息都是**现场读**的：provider 输入每次都从当前的 state 和 registry 临时拼。

问题在于：如果一轮进行到一半，外部又改了 registry（加了个工具、删了个工具），这一轮就前后对不上了——provider 这一轮第一次看到的工具列表，和后来看到的不一样。一轮执行到一半被外部改动干扰，结果就说不清。

可以先看一个小事故：provider 第一轮看到 1 个工具，工具执行过程中外部又注册了第 2 个工具。下一轮如果重新读 registry，同一个 turn 里的工具集合就变了。模型看到的世界前后不一致，调试时很难判断到底是哪一轮出了问题。

s06 要在一轮开始时，把本轮依赖的东西**先固定下来**。

---

## 解决方案

一轮开始先拍一份快照 `TurnSnapshot`，固定 **messages** 和 **tools**。之后本轮的 tools 都用快照里的，不管外部怎么改 registry。

```text
AgentState + tools  →  TurnSnapshot  →  本轮 ProviderInput
```

先记住这条：snapshot 不是把整个世界冻住，只是把本轮需要稳定的输入固定下来。

这里有个关键区分（也是和 Pi 对齐的地方）：**快照固定的是"外部可变的配置"（tools），不是所有东西。**

- **tools**：外部能改（registry 随时变），所以要固定。
- **messages**：core 内部的，循环里 toolResult 会不断追加，取实时值。
- **model**：是 **agent 级的跨轮配置**，放 `AgentState`，**不进单轮快照**——对齐 Pi 的 `AgentContext`（它也不含 model）。

---

## 工作原理

**先定义快照。** 两个字段：本轮的消息、本轮的工具说明。

```ts
export type TurnSnapshot = {
  messages: ProviderMessage[];
  tools: ToolSpec[];
};
```

**model 不在快照里，在 AgentState。** 这是和"把 model 当输入参数"的区别——model 是 agent 的跨轮配置，一轮内不变、跨轮可换，所以它属于状态，不属于单轮快照。

```ts
export type AgentState = {
  messages: AgentMessage[];   // s07 会升级为 SessionTree
  model: string;              // s06 起加：跨轮配置
};
```

**在循环开始前拍。** `runEventedToolLoop` 进循环前，由调用方先 `createTurnSnapshot`。之后整个循环都用这份快照的 tools。

```ts
const snapshot = createTurnSnapshot(state, registry);
```

**本轮输入从快照取。** `buildProviderInputFromSnapshot`：messages 用实时的（循环内会增长），tools 用快照的（固定）。

```ts
export function buildProviderInputFromSnapshot(
  snapshot: TurnSnapshot,
  state: AgentState,
): ProviderInput {
  return {
    messages: toProviderMessages(state.messages),   // 实时
    tools: snapshot.tools,                          // 固定
  };
}
```

> 这一节真正建立的是**一轮状态边界**：一轮一旦开始，它依赖的配置（tools）就冻结了。messages 该增长还增长，model 在 state 里跨轮——这正好对齐 Pi 的 `AgentContext`（固定 systemPrompt/messages/tools，model 在 `AgentState`）。

---

## 试一下

运行：

```sh
npm run s06
```

输出类似：

```text
s06: Turn Snapshot

[snapshot 固定性]
snapshot.tools: 1
registry 现在: 2
state.model: demo-small（跨轮配置，不在 snapshot）

[user]
现在几点？

message_start
tool_call: current_time
...
message_end: stop

[provider 看到的 tools]
tools: 1
```

观察重点：`[snapshot 固定性]` 里 snapshot 拍下时只有 1 个工具，之后 registry 加到 2 个，但快照没变；`[provider 看到的 tools]` 也是 1——本轮 provider 自始至终只看到快照里的那一个。model 在 `state.model`，不进快照。

---

## 接入主线

s06 在 s05 上累积。相对 s05 的变更：

| 组件 | s05 | s06 |
| --- | --- | --- |
| `AgentState` | `{ messages }` | `{ messages, model }`（加 model 跨轮配置，对齐 Pi） |
| 新增类型 | — | `TurnSnapshot { messages, tools }` |
| 新增函数 | — | `createTurnSnapshot` / `buildProviderInputFromSnapshot` |
| `runEventedToolLoop` | `(..., userInput, output)` | 接收外部拍好的 `snapshot`（替换 userInput） |

**焊接点**：调用方先 `createTurnSnapshot(state, registry)`；循环内 `buildProviderInputFromSnapshot(snapshot, state)`——messages 实时、tools 固定。model 在 AgentState，不进 ProviderInput/snapshot（对齐 Pi 的 `Context` 不含 model）。

---

## 接下来

到现在为止，历史还只是一根直线——messages 是个数组，只能一条接一条往后排。

下一节会让历史能分叉：从中间某条岔出去，再走一条不同的路。

进入下一节：[s07](../s07_session_tree/)。

---

<details>
<summary>Pi 源码溯源：AgentContext —— 每轮一份不可变快照</summary>

教学版的 `TurnSnapshot` 固定 messages/tools。Pi 的等价物叫 `AgentContext`，每轮新建、不可变。

### 源码在哪

- `packages/agent/src/types.ts:387` — `AgentContext`
- `packages/agent/src/agent-loop.ts:103` — 每轮拷贝构造

### AgentContext 的真实形状

```ts
interface AgentContext {
  systemPrompt: string;       // 本轮系统提示（固定）
  messages: AgentMessage[];   // 本轮对话历史（固定）
  tools?: AgentTool[];        // 本轮工具（固定）
}
```

教学版的 TurnSnapshot 字段（messages/tools）是 AgentContext 的子集——Pi 还固定了 systemPrompt（s08 会引入）。**注意 Pi 把 model 放在 `AgentState`（不在 AgentContext）**，因为 model 是跨轮的配置，不是单轮快照内容。教学版 s06 正是对齐了这点：model 在 AgentState，TurnSnapshot 不含 model。

### 每轮新建，浅拷贝

`agent-loop.ts:103`：

```ts
const currentContext: AgentContext = {
  ...context,
  messages: [...context.messages, ...prompts],   // 浅拷贝新数组
};
```

每轮创建新的 context 对象，messages 用新数组——本轮往里 push toolResult 不会污染原始 context。这正是教学版 snapshot 的"固定"语义。

### turn_start / turn_end 事件

Pi 在每轮边界发事件（`types.ts:408`）：`turn_start` 和 `turn_end`（带 message 和 toolResults）。UI 和 extension（s09）靠它们观察一轮起止——教学版没有"轮"事件。

### convertToLlm：发之前再过滤

`AgentContext.messages` 是 core 内部的完整历史。真正发给 provider 前，Pi 还有一道 `convertToLlm` 过滤——把不该发给 LLM 的消息剔掉。snapshot 固定 core 侧，convertToLlm 管 provider 侧，两道关一起保证一轮输入既稳定又干净。

### 一句话

教学版的 TurnSnapshot 立的是"一轮开始把输入固定下来"。Pi 用 `AgentContext` 坐实它：每轮新建不可变副本 + turn 事件 + 发送前的 convertToLlm 过滤。关键对齐点：**model 在 AgentState 不进快照**，两边一致。

</details>
