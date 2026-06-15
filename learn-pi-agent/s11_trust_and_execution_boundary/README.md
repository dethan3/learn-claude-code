# s11: Trust and Execution Boundary — 加载有 trust，执行靠容器

> *加载在 core 里管，执行交给容器。*
> **Pi 边界**：执行权限边界 —— 资源加载看 trust，执行边界不内置、靠部署层 containerization。

[上一节：s10](../s10_runtime_modes/) → `s11` → [下一节：s12](../s12_package_distribution/)

---

## 问题

core 会接触本地项目：要加载项目资料（s08），工具也会执行本地动作（s04）。

这两件事**风险差很多**：加载一份资料只是读，执行一个动作可能改动系统。所以加载该有个开关——不可信的项目，连资料都别加载，防恶意 AGENTS.md 或扩展混进来。

但"执行"这件事，Pi 的真实取舍和我们直觉不同：**它不在 core 里限制执行权限**。文件系统、进程、网络全开放，权限等于启动它的用户。真要隔离执行，靠部署层把整个进程关进容器。

s11 就把这两件事的真实分工摆出来：加载在 core 里用 trust 管，执行边界交给容器。

---

## 解决方案

两个层次，分工明确：

| 层 | 在哪 | 管什么 |
| --- | --- | --- |
| **加载** | core 内（trust） | 不可信项目不加载资料，防恶意资源 |
| **执行** | 部署层（containerization） | 整个进程关进沙箱/容器，限制文件/进程/网络 |

containerization 有三种 pattern（见 Pi 的 `containerization.md`）：

```text
OpenShell       整个 pi 进程跑在策略控制的沙箱
Gondolin        pi 留主机，工具执行路由到 Linux 微虚拟机
Plain Docker    整个 pi 进程跑在本地容器
```

> **重要**：教学版**不再发明** `ExecutionPolicy`/`Executor` 那种"core 内 dryRun/allow 开关"——它在 Pi 里没有对应物。core 内唯一能拦住执行的，是 s05 的 `beforeToolCall` hook（按工具 allow/block）。系统级的执行隔离，整体推给容器。

---

## 工作原理

**先定信任开关。**

```ts
export type ProjectTrust = "trusted" | "untrusted";
```

**资源加载看 trust。** `load(trust)` 在 untrusted 时直接返回空——core 拿不到任何项目资料。

```ts
load(trust: ProjectTrust = "trusted"): ContextResource[] {
  if (trust === "untrusted") return [];
  return this.resources.map((r) => ({ ...r }));
}
```

`createTurnSnapshot` 把 trust 透传给 load，所以拍快照时就决定了本轮装不装资料。

**执行不靠 core 管。** 这里没有 `ExecutionPolicy`、没有 `Executor`。`executeToolCall` 的签名回到 s05 的样子（无 policy 参数）：

```ts
export function executeToolCall(registry, hooks, call): ToolResultMessage {
  const before = hooks.beforeToolCall?.(call) ?? { type: "allow" };
  if (before.type === "block") return { /* blocked */ };
  // ... 真正执行 handler，错误捕获 ...
}
```

唯一能拦住执行的，是 `beforeToolCall` hook——它是扩展层的、按工具的拦截，不是系统级权限。要系统级隔离执行，去部署层用容器。

> 这一节真正建立的是**执行权限边界**，而且是对齐 Pi 的真实取舍：**加载**在 core 里用 trust 管（防恶意资源），**执行**不在 core 里管，整体交给部署层 containerization。core 保持轻量，权限的"重活"推给容器——这正是 README 里说的"Pi 不内置 permission system"。

---

## 试一下

运行（默认 trusted）：

```sh
npm run s11
```

输出类似：

```text
s11: Trust and Execution Boundary

[resources]
AGENTS.md

[execution boundary]
Pi 不在 core 内限制执行权限。执行边界靠部署层 containerization：
- OpenShell：整个 pi 进程跑在策略控制的沙箱
- Gondolin：pi 留主机，工具执行路由到 Linux 微虚拟机
- Plain Docker：整个 pi 进程跑在本地容器
core 内唯一的执行拦截点是 s05 的 beforeToolCall hook。
```

不可信项目（不加载资料）：

```sh
npm run s11 -- --trust untrusted
```

```text
[resources]
none（untrusted，不加载任何资料）
```

观察重点：trust 只管"加载不加载资料"；执行边界那段说明清楚——core 里没有 dryRun/allow 开关，真要限制执行得用容器。

---

## 接入主线

s11 在 s10 上累积。相对 s10 的变更：

| 组件 | s10 | s11 |
| --- | --- | --- |
| 新增类型 | — | `ProjectTrust` |
| `ResourceLoader.load` | `load()` | **`load(trust)`**（U1，默认 trusted） |
| `createTurnSnapshot` | `(state, registry, loader)` | 多一个 `trust`（默认 trusted） |
| 执行权限 | 只有 hook | **trust 控加载；执行靠 containerization（core 内不内置 permission）** |

**焊接点**：`loader.load(trust)` 决定 context 装不装资料；`createTurnSnapshot` 透传 trust。`executeToolCall` 保持 s05 的签名（无 policy）——执行拦截只有 beforeToolCall hook，系统级隔离交给容器。

> 注：本节移除了早期教学版的 `ExecutionPolicy`/`Executor`。它们是为了"自演示执行边界"而发明的，但 Pi 真实没有这层——保留会让内核和 Pi 不一致。

---

## 接下来

现在工具、命令、项目资料都是零散定义的。想复用一组能力，没有个清单说明"这包里有什么"。

下一节会把它们整理成一个带清单的包，方便整体分发和加载。

进入下一节：[s12](../s12_package_distribution/)。

---

<details>
<summary>Pi 源码溯源：不内置 permission，靠 containerization</summary>

教学版用 trust 控加载。Pi 的真实情况值得特别说明——**它不内置 permission 系统**，权限边界靠外部容器化。

### 源码在哪

- `packages/coding-agent/docs/containerization.md` — 三种容器化方案（官方文档）
- `packages/coding-agent/src/core/project-trust.ts:45` — `resolveProjectTrusted`
- `packages/coding-agent/src/core/extensions/runner.ts` — trust 事件
- `packages/coding-agent/src/tools/bash.ts:66` — bash 执行（无权限检查）

### 核实：Pi 确实不内置 permission

README 说"Pi 不内置 permission system"。源码证实：`createLocalBashOperations`（`bash.ts:66`）直接 `spawn(shell, ...)`，**没有任何权限检查**——文件系统、进程、网络全开放，权限等于启动它的用户。

### 那 trust 管什么

Pi 的 `ProjectTrust`（`project-trust.ts:45`）只管**资源加载**，不管执行：

```ts
async function resolveProjectTrusted(options): Promise<boolean> {
  if (options.trustOverride !== undefined) return options.trustOverride;
  if (!hasProjectTrustInputs(options.cwd)) return true;       // 没有可信任输入，直接信任
  const { result } = await emitProjectTrustEvent(...);          // 问扩展 hook
  if (result) return result.trusted === "yes";
  const decision = options.trustStore.get(options.cwd);        // 查历史决策
  if (decision !== null) return decision;
  switch (options.defaultProjectTrust ?? "ask") {              // 默认问用户
    case "always": return true;
    case "never": return false;
    case "ask": break;
  }
}
```

trust 决定"要不要加载这个项目的扩展/资源"（防恶意 AGENTS.md 或扩展），**不限制**加载之后的执行。

### 三种容器化方案

`containerization.md` 给三种 pattern：

| 方案 | 怎么做 | 适用 |
| --- | --- | --- |
| **OpenShell** | 整个 pi 进程跑在策略控制的沙箱 | 想全面限制 |
| **Gondolin 扩展** | pi 留在主机，工具执行路由到 Linux 微虚拟机 | 想保护 provider auth |
| **Plain Docker** | 整个 pi 跑在本地容器 | 简单隔离 |

### beforeToolCall 是唯一的执行拦截点

Pi 唯一能拦截执行的，是 s05 的 `beforeToolCall` hook——扩展可以在那里 block 某个工具。但这是扩展层的、按工具的，不是 core 内置的、系统级的权限系统。

### 一句话

教学版用 trust 控加载，和 Pi 对齐；执行边界也对齐——**不内置**，靠 containerization 三方案在部署层做。早期教学版发明过 `ExecutionPolicy`，但那是为了自演示，Pi 真实没有，所以本节移除了它。

</details>
