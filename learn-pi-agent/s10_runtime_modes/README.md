# s10: Runtime Modes — 同一个 core，不同的展示

> *core 只管产生，怎么展示外层说了算。*
> **Pi 边界**：运行方式边界 —— core 产生事件，展示方式是外层的事，换展示不改 core。

[上一节：s09](../s09_extension_runtime/) → `s10` → [下一节：s11](../s11_trust_and_execution_boundary/)

---

## 问题

前面几节里，core 一产生结果就直接打印出来——展示方式写死在代码里。

但"展示"这件事，不同场景要的不一样：给人看，要人类可读的文本；给别的程序看，要结构化的 JSON；以后可能还要 GUI 渲染。如果展示方式写死在 core 里，每换一种就得复制或改动 core。

core 只该管**产生**什么，**怎么展示**应该分离出去。

---

## 解决方案

core 把要做的事变成一批 `RuntimeEvent`，外层用一个 `RuntimeMode` 决定怎么展示。

```text
createDemoRuntimeEvents()  →  RuntimeEvent[]  →  RuntimeMode.render()
```

同一个 core、同一批事件，接不同的 mode 就有不同输出：

| mode | 展示成 |
| --- | --- |
| `PrintMode` | 人类可读文本（只打印 message） |
| `JsonMode` | 结构化 JSON（每事件一行） |

> **[R7 收获]** 回想 s01：那时候 core 不直接 `console.log`，而是走了一层 `Output.log`。那是一个最小的"输出抽象"种子。s10 把它正式化、可切换了——同一个 core 的事件，想打印就 PrintMode，想 JSON 就 JsonMode，core 一个字都不用改。

这里不是替换 s01-s09 的 `runEventedToolLoop`。为了让本节输出短一点，demo 用 `createDemoRuntimeEvents()` 造一批最小事件；真正的主线里，这批事件来自前面已经累积出来的 core。

---

## 工作原理

**先准备一批事件。** `createDemoRuntimeEvents` 把输入变成一批最小 RuntimeEvent。它只是本节的演示事件源，不是新的主循环。

```ts
export function createDemoRuntimeEvents(input: string): RuntimeEvent[] {
  return [
    { type: "message", content: `收到：${input}` },
    { type: "done" },
  ];
}
```

**mode 消费事件。** RuntimeMode 只有一个方法 `render`。PrintMode 挑出 message 打印文本；JsonMode 把每个事件序列化成 JSON。

```ts
export type RuntimeMode = { render(events: RuntimeEvent[]): void };

export class PrintMode implements RuntimeMode {
  render(events) {
    for (const event of events) {
      if (event.type === "message") console.log(event.content);
    }
  }
}

export class JsonMode implements RuntimeMode {
  render(events) {
    for (const event of events) console.log(JSON.stringify(event));
  }
}
```

> 这一节真正建立的是**运行方式边界**：core 产生事件，展示是外层 mode 的事。RuntimeEvent 是 core 对外的"输出语言"，mode 是"翻译器"。换展示方式只是换 mode，core 不动——这正是 s01 那层 Output 抽象要长成的样子。

---

## 试一下

运行：

```sh
npm run s10
```

输出类似：

```text
s10: Runtime Modes

[print mode]
收到：你好，mini Pi

[json mode]
{"type":"message","content":"收到：你好，mini Pi"}
{"type":"done"}
```

观察重点：两种输出来自**同一批事件**——`[print mode]` 只显示了 message 内容，`[json mode]` 把每个事件都序列化了，包括 `done`。

---

## 接入主线

s10 在 s09 上累积。相对 s09 的变更：

| 组件 | s09 | s10 |
| --- | --- | --- |
| 新增类/函数 | — | `createDemoRuntimeEvents`（演示事件源）/ `PrintMode` / `JsonMode` |
| 新增类型 | — | `RuntimeMode` |
| 输出抽象 | `Output.log`（s01 起，逐行） | `RuntimeMode.render`（可切换展示） |
| 主循环 / `ProviderInput` | — | **不变**（纯新增，无 U1 升级） |

**焊接点**：前面主线产出的 `RuntimeEvent[]` 交给 `RuntimeMode.render`；本节 demo 只用 `createDemoRuntimeEvents` 代替真实事件源。`PrintMode` / `JsonMode` 各自 `render` 同一批事件，core 与展示彻底分开。

---

## 接下来

core 会接触本地项目：要加载项目资料，也可能要执行本地动作。这两件事的风险不一样，得分开管。

下一节会把"能不能加载资料"和"能不能执行动作"拆成两个独立的开关。

进入下一节：[s11](../s11_trust_and_execution_boundary/)。

---

<details>
<summary>Pi 源码溯源：四种 AppMode 和自动分流</summary>

教学版两种 mode（Print/Json）消费同一批事件。Pi 的 `packages/coding-agent` 有四种运行模式，按终端环境自动分流。

### 源码在哪

- `packages/coding-agent/src/cli/args.ts:10` — `AppMode` 类型
- `packages/coding-agent/src/main.ts:98` — `resolveAppMode`（分流逻辑）
- `packages/coding-agent/src/main.ts:768` — 各模式入口
- `packages/coding-agent/src/modes/print-mode.ts` — print 模式

### 四种模式

```ts
type AppMode = "interactive" | "print" | "json" | "rpc";
```

| 模式 | 什么时候用 | 怎么输出 |
| --- | --- | --- |
| interactive | stdin 和 stdout 都是 TTY | TUI 差分渲染（`pi-tui`） |
| print | `--print` 或管道输入 | 纯文本，跑完退出 |
| json | `--mode json` | 结构化 JSON 事件流 |
| rpc | `--mode rpc` | JSON-RPC 接口，给编辑器/工具集成 |

教学版的 PrintMode/JsonMode 是 print 和 json 两种的极简版。

### 自动分流

`resolveAppMode`（`main.ts:98`）的判定顺序：

```ts
function resolveAppMode(parsed, stdinIsTTY, stdoutIsTTY): AppMode {
  if (parsed.mode === "rpc") return "rpc";      // 显式 rpc 最优先
  if (parsed.mode === "json") return "json";    // 显式 json
  if (parsed.print || !stdinIsTTY || !stdoutIsTTY) return "print";  // 管道自动 print
  return "interactive";                          // 默认交互
}
```

关键设计：**管道自动降级到 print**。把 pi 接到管道（`echo hi | pi`）时，它检测到 stdin 不是 TTY，自动用 print 模式——不会傻乎乎起一个 TUI。教学版没有这个自动检测。

### TUI 用差分渲染

interactive 模式（`main.ts:770`）用 `@earendil-works/pi-tui`，这是个专门的终端 UI 库，做差分渲染（只重绘变化的部分）——流式输出时不会闪烁。教学版的 mode 只是 console.log，没有渲染层。

### 一句话

教学版的 RuntimeMode 立的是"core 产事件、外层决定展示"。Pi 把它坐实成四种 AppMode + 管道自动降级 + TUI 差分渲染。同一个 agent core，接 TTY 是交互式、接管道是 print、接工具是 json/rpc——core 一个字不用改。

</details>
