# s09: Extension Runtime — 外部代码通过 API 接入

> *core 不改，能力从外面接进来。*
> **Pi 边界**：扩展 API 边界 —— core 暴露的是 API，不是内部对象。

[上一节：s08](../s08_context_resources/) → `s09` → [下一节：s10](../s10_runtime_modes/)

---

## 问题

到 s08 为止，core 的能力（工具、资源）全都写在 core 代码里。每想加一种新玩法——一个新工具、一条新命令、对某类事件做个处理——都得改 core 自己。core 只会越来越重。

s09 要让**外部代码**接入 core，core 不用动就能长出新能力。

---

## 解决方案

core 暴露一个 `ExtensionAPI`，外部代码（叫一个 extension）只能通过它做三件事：

```text
on(type, handler)        订阅事件
registerTool(tool)       注册工具
registerCommand(command) 注册命令
```

一个 extension 就是一个接收 API 的函数。它拿不到 core 的内部对象，只能用这三个方法。

关键设计：`registerTool` 复用的是 s02 就有的 `Tool` 类型，注册进去的工具直接进**既有 ToolRegistry**。也就是说，extension 注册的工具和 core 内置的工具，走的是**同一条执行链**（经过 s05 的 hook）——不分彼此。

---

## 工作原理

**先定义事件和命令。** 事件是 core 往外发的信号；命令是外部注册的无参动作。

```ts
export type RuntimeEvent =
  | { type: "message"; content: string }
  | { type: "done" };

export type Command = { name: string; run: () => string };
```

**定义 API 表面。** 这就是 extension 能碰的全部。

```ts
export type ExtensionAPI = {
  on(type: RuntimeEvent["type"], handler: (event: RuntimeEvent) => void): void;
  registerTool(tool: Tool): void;
  registerCommand(command: Command): void;
};

export type Extension = (api: ExtensionAPI) => void;
```

**ExtensionRuntime 接住注册。** 它构造时接收既有 registry；`registerTool` 直接往这个 registry 里加。

```ts
export class ExtensionRuntime {
  constructor(private registry: ToolRegistry) {}
  createApi(): ExtensionAPI {
    return {
      on: (type, handler) => { this.handlers.push({ type, handler }); },
      registerTool: (tool) => { this.registry.register(tool); }, // 注入既有 registry
      registerCommand: (command) => { this.commands.set(command.name, command); },
    };
  }
  emit(event) { /* 按类型匹配 handler，不是全调 */ }
  runCommand(name) { /* 找不到返回 unknown command */ }
}
```

两个细节：`emit` 按**事件类型**匹配 handler（不是把所有 handler 都调一遍）；命令找不到时返回一句说明，不抛错。

> 这一节真正建立的是**扩展 API 边界**：core 对外只给一个受控的 API，extension 加的工具和内置工具同源同链，事件按类型分发。后面 s11 的权限检查会同样作用在 extension 注册的工具上，因为它们本就在同一个 registry 里。

---

## 试一下

运行：

```sh
npm run s09
```

输出类似：

```text
s09: Extension Runtime

[registry]
tool: current_time
tool: note

[event] message: hello from core

[command]
/status -> extension is active

[tool via extension]
note -> note saved: hi
```

观察重点：`[registry]` 里 `current_time` 是内置的、`note` 是 extension 注册的，两者同处一个 registry；`[tool via extension]` 里 extension 的工具走的还是 `executeToolCall` 那条既有执行链。

---

## 接入主线

s09 在 s08 上累积。相对 s08 的变更：

| 组件 | s08 | s09 |
| --- | --- | --- |
| 新增类型 | — | `RuntimeEvent`（U2 全局唯一）/ `Command` / `Extension` / `ExtensionAPI` |
| 新增类 | — | `ExtensionRuntime`（构造接收既有 `ToolRegistry`） |
| 工具来源 | 只有 core 内置 | core 内置 + extension 注册（同一 registry） |
| `ProviderInput` / 主循环 | — | **不变**（纯新增，无 U1 升级） |

**焊接点**：`ExtensionRuntime` 构造接收既有 `ToolRegistry`；`registerTool` 往里加。extension 工具和内置工具同源，执行时都走 `executeToolCall`。

---

## 接下来

现在 core 能产生结果，但结果怎么展示（打印？JSON？）写死在代码里。

下一节会把"产生结果"和"展示结果"分开：同一个 core，接不同的输出方式。

进入下一节：[s10](../s10_runtime_modes/)。

---

<details>
<summary>Pi 源码溯源：Extension API 和它的 20 多个事件</summary>

教学版的 ExtensionAPI 暴露 on/registerTool/registerCommand 三个方法。Pi 的 `packages/coding-agent` 有一套庞大得多的 extension 系统。

### 源码在哪

- `packages/coding-agent/src/core/extensions/types.ts` — `ExtensionAPI` 类型
- `packages/coding-agent/src/core/extensions/loader.ts` — 发现 + 加载
- `packages/coding-agent/src/core/extensions/runner.ts` — 运行时
- `.pi/extensions/` — 项目级扩展目录

### API 比教学版大得多

教学版三个方法。Pi 的 `ExtensionAPI`（`types.ts`）有一长串：

```ts
interface ExtensionAPI {
  // 注册能力
  registerTool(tool): void;
  registerCommand(name, options): void;
  registerFlag(name, { description, type, default }): void;
  // 订阅事件（20+ 种）
  on(event: "session_start" | "tool_execution_start" | "before_agent_start" | ..., handler): void;
  // 运行时动作
  sendMessage(msg): void;
  setModel(model): void;
  getActiveTools(): AgentTool[];
  registerProvider(...) / unregisterProvider(...): void;
  exec(command): Promise<...>;
}
```

教学版的 on/registerTool/registerCommand 是它的一个子集。Pi 的 extension 不仅能加工具/命令，还能改模型、注册 provider、执行命令、订阅 20 多种生命周期事件。

### 20 多种事件

教学版只有 `message` / `done` 两种 RuntimeEvent。Pi 的 extension 能订阅 `session_start`、`tool_execution_start`、`before_agent_start`、`project_trust`（s11 用它决定信任）……覆盖整个 agent 生命周期。每个事件的 handler 还能返回结果反向影响 core（比如 `before_agent_start` 的返回值能改本轮配置）。

### 四种发现来源

`discoverAndLoadExtensions`（`loader.ts:557`）从四个地方找扩展：

```text
1. cwd/.pi/extensions/                项目级
2. agentDir/.pi/extensions/           全局级
3. package.json 的 pi.extensions 字段  包声明
4. 命令行传入的路径                    CLI 级
```

教学版的 extension 是手动 `runtime.use(...)`。Pi 是自动发现——放对目录就加载。

### 冲突检测 + 沙箱

两个扩展注册同名工具怎么办？`detectExtensionConflicts`（`loader.ts:988`）检查工具/命令/标志名冲突，通过 `ResourceDiagnostic` 报告，保留先加载的。扩展代码跑在 jiti 沙箱里，每个扩展有 `sourceInfo` 标记来源和权限级别——这是教学版完全没有的隔离层。

### notInitialized 守卫

`createExtensionRuntime`（`runner.ts`）有个巧思：扩展加载阶段（执行 factory 函数时），runtime 的动作方法（sendMessage 等）都指向 `notInitialized`——一调用就抛错。因为加载时 core 还没就绪，扩展只能"注册"，不能"动作"。加载完成后才换上真实实现。

### 一句话

教学版的 ExtensionAPI 立的是"外部代码通过受控 API 接入 core"。Pi 把它坐实成 20 多个事件 + 注册 tool/command/flag/provider + 四种自动发现 + 冲突检测 + 沙箱隔离。教学版只保留最小接入（on/registerTool/registerCommand + 手动 use），但"core 暴露 API 而非内部"这条边界一致。

</details>
