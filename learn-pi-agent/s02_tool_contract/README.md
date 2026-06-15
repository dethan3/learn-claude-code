# s02: Tool Contract — 工具先变成说明

> *把能力写成说明，再决定给谁看。*
> **Pi 边界**：工具契约边界 —— 给 provider 的工具说明，和留在 core 的执行函数，分开。

[上一节：s01](../s01_minimal_agent_core/) → `s02` → [下一节：s03](../s03_provider_event_stream/)

---

## 问题

s01 里，provider 只看到了对话（messages）。但 core 手里其实还有本地能力：读一条笔记、看一眼当前时间。

怎么让 provider 知道这些能力？直觉是直接把函数塞给它。但这走不通——provider 只是一个收文本、回文本的端点，它看不懂一段可执行代码，更不可能在它那边把代码跑起来。

所以得先把能力翻译成 provider 能读的东西：一份**说明**。

s02 只做这一件事：把本地能力变成说明，交给 provider。本节还不执行任何工具。

---

## 解决方案

一个工具拆成两层：

```text
Tool
  spec     →  进 ProviderInput，给 provider 看
  handler  →  留在本地 ToolRegistry
```

provider 收到的永远是 `spec`（说明），`handler`（执行函数）从不出 core。

这里有个故意的分隔：**provider 看得见的工具集合，和 core 实际跑得了的工具集合，不一样。** provider 只看到说明，看不到、也碰不到执行函数。这条分隔从 s02 立起来，后面所有和工具相关的机制都建立在它之上。

---

## 工作原理

**先定义说明。** 一份工具说明要回答三件事：叫什么名字、干什么用、要什么参数。

```ts
export type ToolSpec = {
  name: string;
  description: string;
  input: Record<string, string>;
};
```

**再定义本地执行。** handler 是一段普通函数，待在 core 这边，provider 看不见它。

```ts
export type ToolHandler = (input: Record<string, string>) => string;
```

**把两层合起来是一个完整工具。** spec 和 handler 在 Tool 里配对，但只有 spec 会离开 core。

```ts
export type Tool = {
  spec: ToolSpec;
  handler: ToolHandler;
};
```

**用一个登记表把它们收起来。** ToolRegistry 持有完整工具，但它对外只交出说明——`getSpecs()` 返回 spec，不带 handler。

```ts
export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.spec.name, tool);
  }

  getSpecs(): ToolSpec[] {
    return [...this.tools.values()].map((tool) => tool.spec);
  }
}
```

**最后把说明塞进 provider 输入。** s01 的 ProviderInput 只有 messages，现在多一个 tools。`buildProviderInput` 接收 registry，把 `registry.getSpecs()` 放进去。

```ts
export type ProviderInput = {
  messages: ProviderMessage[];
  tools: ToolSpec[];
};

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
```

> 这一节真正建立的不是某个函数，而是**说明和执行分开**：provider 拿到的永远是说明，handler 永远不出 core。后面 s04 会让 provider 真的"调用"工具，但即便到那时，provider 发出的也只是一个调用请求，handler 仍然在 core 这边跑。

---

## 试一下

运行：

```sh
npm run s02
```

输出类似：

```text
s02: Tool Contract

[tools registered]
read_note: 读取一条笔记
current_time: 返回一个固定的演示时间

[provider input]
messages: 1
tools: 2
- read_note: 读取一条笔记
- current_time: 返回一个固定的演示时间

[assistant]
content: 我看到 2 个工具：read_note, current_time
stopReason: stop
```

观察重点：`[provider input]` 的 tools 里只有说明（name / description），没有任何执行函数；`[tools registered]` 和 provider 看到的是同一份说明。

---

## 接入主线

s02 在 s01 上累积。相对 s01 的变更：

| 组件 | s01 | s02 |
| --- | --- | --- |
| `ProviderInput` | `{ messages }` | `{ messages, tools }`（R1 只增） |
| 新增类型 | — | `ToolSpec` / `ToolHandler` / `Tool` |
| 新增类 | — | `ToolRegistry`（`register` / `getSpecs`） |
| `buildProviderInput` | `(state)` | `(state, registry)` |
| `runOneTurn` | `(state, provider, userInput)` | `(state, provider, registry, userInput)` |

**焊接点**：`buildProviderInput` 把 `registry.getSpecs()` 塞进 `ProviderInput.tools`；handler 留在 registry，绝不进 ProviderInput。

---

## 接下来

现在 provider 能看到工具说明了，但它还是一次性吐出整段回复，core 得等到最后才知道它说了什么。

下一节会改变 provider 返回结果的方式——不再一次性返回，而是一段一段地往外送。

进入下一节：[s03](../s03_provider_event_stream/)。

---

<details>
<summary>Pi 源码溯源：工具的双层定义</summary>

教学版用 `Tool = { spec, handler }` 一层搞定。Pi 把工具拆成**两层类型**，分属两个 package。

### 源码在哪

- `packages/ai/src/types.ts:338` — `Tool`（给 provider 看的那层）
- `packages/agent/src/types.ts:361` — `AgentTool`（本地执行的那层）
- `packages/agent/src/agent-loop.ts:548` — `prepareToolCallArguments`（参数预处理）

### 两层工具

**AI 层的 `Tool`**（`ai` 包）只描述能力，不含任何可执行代码——它会被序列化发给 provider：

```ts
interface Tool<TParameters extends TSchema = TSchema> {
  name: string;
  description: string;
  parameters: TParameters;   // TypeBox schema，给 LLM 看的参数结构
}
```

**Agent 层的 `AgentTool`**（`agent` 包）继承 `Tool`，再加执行相关的东西：

```ts
interface AgentTool<TParameters, TDetails> extends Tool<TParameters> {
  label: string;             // UI 显示标签
  prepareArguments?: (args: unknown) => Static<TParameters>;  // 参数预处理
  execute: (toolCallId, params, signal?, onUpdate?) => Promise<AgentToolResult<TDetails>>;
  executionMode?: "sequential" | "parallel";   // 单工具覆盖执行模式
}
```

教学版的 `Tool = { spec, handler }` 把这两层压成一层。Pi 之所以分两个 package，是因为 `ai` 层只关心"怎么跟 LLM 说话"（schema、序列化），`agent` 层才关心"怎么在本地执行"。

### 参数用 TypeBox schema，不是简单对象

教学版 `ToolSpec.input` 是 `Record<string, string>`（字符串字典）。Pi 用 **TypeBox**（`parameters: TSchema`）——一种运行时可校验的 JSON Schema 类型系统：

- 能表达嵌套、枚举、可选、范围（字符串字典做不到）。
- provider 收到的是标准 JSON Schema，跨厂商通用。
- `prepareArguments` 拿到的参数能被 schema 校验和转换。

教学版不引入 schema 库，代价是参数描述很弱（s04 的 ToolCall 也只能带字符串）。

### prepareArguments：参数预处理钩子

教学版 handler 直接吃原始 input。Pi 的 `AgentTool` 多了一个 `prepareArguments`（`agent-loop.ts:548`）：

```ts
function prepareToolCallArguments(tool, toolCall) {
  if (!tool.prepareArguments) return toolCall;
  const prepared = tool.prepareArguments(toolCall.arguments);
  if (prepared === toolCall.arguments) return toolCall;
  return { ...toolCall, arguments: prepared };
}
```

provider 给的参数可能粗糙或带默认值，`prepareArguments` 在执行前统一加工——教学版没有的一层"参数防腐"。

### execute 带 AbortSignal 和 onUpdate

教学版的 `ToolHandler` 是同步的 `(input) => string`。Pi 的 `execute` 多两个参数：

- `signal: AbortSignal`：用户中断时能响应（呼应 s01 的 AbortController）。
- `onUpdate`：执行中往外推流式进度（partialResult），UI 能实时显示"工具跑到哪了"。

教学版的工具是"调一下、拿个字符串"；Pi 的工具是"一个能被中断、能报进度的小任务"。

### 一句话

`Tool = { spec, handler }` 立的是"说明和执行分开"。Pi 把这条边界坐实成两个 package：`ai` 层的 `Tool`（schema、给 LLM）和 `agent` 层的 `AgentTool`（execute、本地），中间隔着参数预处理、中断、进度上报。教学版压成一层，把这条边界先立起来。

</details>
