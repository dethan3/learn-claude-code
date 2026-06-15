# s05: Tool Hook Boundary — 执行前后各留一个口子

> *执行是直线，插口在两头。*
> **Pi 边界**：工具插口边界 —— 执行这个动作被掰成 before / run / after，中间不变，两头可插。

[上一节：s04](../s04_evented_tool_loop/) → `s05` → [下一节：s06](../s06_turn_snapshot/)

---

## 问题

s04 里，provider 一请求工具，core 立刻就执行了——中间没有任何介入的余地。

但真实使用中，执行前后往往要做事：执行前想检查"这个工具现在能不能用""参数合不合规"，执行后想"给结果脱个敏""记一条日志"。如果这些都写死在执行逻辑里，每改一次规则就得动 core，没法按情况调整。

s05 要在执行这个动作的**前后**各留一个插口。

---

## 解决方案

两个插口：

| 插口 | 时机 | 能做什么 |
| --- | --- | --- |
| `beforeToolCall` | 执行前 | 放行（allow）或拦下（block，带原因） |
| `afterToolCall` | 执行后 | 保留结果，或改写后再交出去 |

一个 `executeToolCall` 把执行流程串成三段：

```text
beforeToolCall  →  registry.run()  →  afterToolCall
```

中间那段还是 s04 的 `registry.run`，**ToolRegistry 本身不变**——hook 只是套在外面的一层，不改 core 的执行逻辑。

拦下（block）时 handler 根本不会跑；handler 抛错还是按 s04 的规矩被包成一条结果消息，循环继续。

---

## 工作原理

**先定义插口的返回。** 执行前要么放行、要么拦下并给个原因。

```ts
export type BeforeToolCallResult =
  | { type: "allow" }
  | { type: "block"; reason: string };

export type ToolHooks = {
  beforeToolCall?: (call: ToolCall) => BeforeToolCallResult;
  afterToolCall?: (call: ToolCall, result: string) => string;
};
```

两个插口都可选——不配就相当于全放行、不改写。

**把三段串起来。** `executeToolCall` 就是 before → run → after。block 时直接返回，handler 不执行；handler 抛错在这里收口，不向上传。

```ts
export function executeToolCall(
  registry: ToolRegistry,
  hooks: ToolHooks,
  call: ToolCall,
): ToolResultMessage {
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
```

**接到循环里。** s04 的 `runEventedToolLoop` 现在 `tool_call` 这一步不再直接调 `registry.run`，而是调 `executeToolCall`。对循环来说，拿到的还是一个 ToolResultMessage，流程没变——只是中间多过了一层插口。

> 这一节真正建立的是**工具插口边界**：执行被掰成 before / run / after 三段，中间那段是 core 的固定逻辑，两头是可以从外面配置的钩子。后面 s11 的权限检查会直接接到 beforeToolCall 上，但"执行本身不动、规则插在两头"这条规矩，从这里立起来。

---

## 试一下

运行（放行路径）：

```sh
npm run s05
```

输出类似：

```text
s05: Tool Hook Boundary

[user]
复读一下 hi

message_start
tool_call: echo
[beforeToolCall]
allow: echo
[afterToolCall]
echo -> hi
tool_result: checked: hi
message_end: toolUse
message_start
text_delta: 工具结果是：checked: hi
message_end: stop

[assistant]
content: 工具结果是：checked: hi
stopReason: stop
```

再运行（拦截路径）：

```sh
npm run s05 -- --case blocked
```

输出类似：

```text
message_start
tool_call: dangerous
[beforeToolCall]
block: dangerous
tool_result: blocked: 这个工具在演示里被禁用
message_end: toolUse
message_start
text_delta: 工具结果是：blocked: 这个工具在演示里被禁用
message_end: stop
```

观察重点：放行时 handler 跑了、afterToolCall 把结果改成了 `checked: ...`；拦截时 handler 根本没跑（"不该执行到这里"从未出现），结果直接是 `blocked: ...`。

---

## 接入主线

s05 在 s04 上累积。相对 s04 的变更：

| 组件 | s04 | s05 |
| --- | --- | --- |
| 新增类型 | — | `BeforeToolCallResult` / `ToolHooks` |
| 新增函数 | — | `executeToolCall`（把 s04 内联的 run + 错误捕获收口到这里） |
| `runEventedToolLoop` | `(state, provider, registry, userInput, output)` | 多一个 `hooks` 参数；`tool_call` 走 `executeToolCall` |
| `ToolRegistry` | `register / getSpecs / run` | **不变**（R2：hook 是外层装饰） |

**焊接点**：循环内 `tool_call` → `executeToolCall(registry, hooks, call)` → ToolResultMessage 进 messages。registry 未改动，hook 套在执行外面。

---

## 接下来

现在每一轮执行，信息都是现场从各个对象里读的。如果一轮开始后外部又改了工具列表或模型名，这一轮就会变得说不清。

下一节会把一轮开始时用到的信息，先集中拍成一份快照。

进入下一节：[s06](../s06_turn_snapshot/)。

---

<details>
<summary>Pi 源码溯源：beforeToolCall / afterToolCall 的真实位置</summary>

教学版的 hook 是 `executeToolCall` 里的两个可选函数。Pi 的 hook 长在并发工具执行的 prepare/finalize 两侧，且能拿到比教学版丰富得多的上下文。

### 源码在哪

- `packages/agent/src/types.ts:83` — `BeforeToolCallContext` / `AfterToolCallContext`
- `packages/agent/src/types.ts:262` — `beforeToolCall` / `afterToolCall` 签名
- `packages/agent/src/agent-loop.ts:581` — beforeTool 触发点
- `packages/agent/src/agent-loop.ts:676` — afterTool 触发点

### hook 能拿到什么

教学版的 `beforeToolCall(call)` 只拿到 ToolCall。Pi 的 context（`types.ts:83`）丰富得多：

```ts
interface BeforeToolCallContext {
  assistantMessage: AgentMessage;   // 触发这次工具调用的那条 assistant 消息
  toolCall: AgentToolCall;          // 工具调用本身
  args: validatedArgs;              // 已经校验过的参数
  context: AgentContext;            // 本轮的完整快照（s06）
}
```

hook 能看到"是哪条 assistant 消息要调这个工具""本轮的完整上下文是什么"——不只是孤立的调用。

### beforeTool 能 block

教学版的 block 返回 `{ block, reason }`。Pi 一致（`agent-loop.ts:581`）：

```ts
if (config.beforeToolCall) {
  const beforeResult = await config.beforeToolCall(
    { assistantMessage, toolCall, args, context }, signal);
  if (beforeResult?.block) {
    return { kind: "immediate",
             result: createErrorToolResult(beforeResult.reason || "blocked"),
             isError: true };
  }
}
```

block 后工具跳过执行，直接生成一条错误结果发回去——和教学版语义一致，但 Pi 把它包成 `kind: "immediate"`（立即返回），无缝接入 s04 的并发执行框架。

### afterTool 能改写结果

教学版的 `afterToolCall(call, result) => string` 只能改 content。Pi 的 `afterToolCall` 能改更多字段（错误标记、terminate 标志等），是字段级覆盖、非深度合并。

### hook 是异步的，且能被中断

教学版的 hook 是同步函数。Pi 的 hook 是 `async`，且都带 `signal: AbortSignal`——用户中断时 hook 也能及时收手。这呼应 s01 的 AbortController 贯穿到每一层。

### 一句话

教学版的 `executeToolCall = before → run → after` 立的是"执行前后留插口"。Pi 把这两个插口坐实在并发执行的 prepare/finalize 两侧，context 更丰富（assistant 消息 + 本轮快照）、异步且可中断。后面 s11 的权限检查会直接接到 beforeToolCall 上。

</details>
