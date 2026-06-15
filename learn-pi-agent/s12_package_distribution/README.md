# s12: Package Distribution — 能力整理成一个包

> *一组能力，一张清单，整体带走。*
> **Pi 边界**：能力分发边界 —— manifest 是入口，决定哪些内容可见。

[上一节：s11](../s11_trust_and_execution_boundary/) → `s12`

---

## 问题

到现在，工具、命令、项目资料都是零散定义的。想复用一整套能力（某个项目的全部工具 + 命令 + 资料），没有个地方说明"这包里到底有什么"。

零散定义没法整体分发，也没法整体加载——拿到一堆内容，不知道哪些该用、哪些是多余的。

s12 要把它们整理成一个**带清单的包**。

---

## 解决方案

一个包由两部分组成：

```text
manifest   清单：声明包里有哪些 tools / commands / resources（按名字）
contents   实际内容：名字 → 内容
```

`loadPackage` 按 manifest 从 contents 里挑出对应内容。**清单就是入口**：清单上列了才加载，没列的（哪怕 contents 里有）一律不进结果。

加载完还要接回主线：`installLoadedPackage` 把 loaded 结果装回已有的 ToolRegistry、commands 和 resources。这样 package 才不只是一个清单解析 demo，而是能真的把能力分发回 mini Pi。

---

## 工作原理

**先定义清单和包。**

```ts
export type PackageManifest = {
  name: string;
  tools: string[];
  commands: string[];
  resources: string[];
};

export type Package = {
  manifest: PackageManifest;
  contents: Record<string, string>;
};
```

**按名字挑内容。** `pick` 从 contents 里取清单上列出的名字；清单列了但 contents 里没有的，跳过（不会因为缺一项就崩）。

```ts
function pick(contents: Record<string, string>, names: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const name of names) {
    const value = contents[name];
    if (value !== undefined) {
      result[name] = value;
    }
  }
  return result;
}
```

**按清单加载。** `loadPackage` 对三类资源分别 pick，产出 LoadedPackage。

```ts
export function loadPackage(pkg: Package): LoadedPackage {
  return {
    name: pkg.manifest.name,
    tools: pick(pkg.contents, pkg.manifest.tools),
    commands: pick(pkg.contents, pkg.manifest.commands),
    resources: pick(pkg.contents, pkg.manifest.resources),
  };
}
```

**再安装回主线。** `loadPackage` 只负责挑内容，`installLoadedPackage` 才负责把内容接回前面已经有的零件。

```ts
export function installLoadedPackage(
  loaded: LoadedPackage,
  registry: ToolRegistry,
  commands: Map<string, Command>,
  resources: ContextResource[],
): void {
  // loaded.tools     -> registry.register(...)
  // loaded.commands  -> commands.set(...)
  // loaded.resources -> resources.push(...)
}
```

加载后的 tools / commands / resources，分别注入 s02 的 ToolRegistry、s09 的 commands、s08 的 ResourceLoader。这一节把前面散落的能力收拢成一个可分发、可安装的整体。

> 这一节真正建立的是**能力分发边界**：manifest 是唯一入口，决定一个包对外暴露什么。contents 里再多东西，只要 manifest 没列，就不会被加载——分发方靠清单精确控制可见能力。

---

## 试一下

运行：

```sh
npm run s12
```

输出类似：

```text
s12: Package Distribution

[manifest]
name: demo-package
tools: note
commands: status
resources: AGENTS.md

[loaded]
tools: 1
commands: 1
resources: 1

[installed]
registry tools: 1
commands: 1
resources: 1
note -> package tool note: tool: 保存一条笔记
/status -> command: 打印包状态
```

观察重点：contents 里其实有 4 项（含一个 `ignored`），但 loaded 只挑出 manifest 列出的 3 类各 1 项——`ignored` 因为不在清单里，没有被加载。随后 installed 证明这 3 项已经接回 mini Pi 的 registry、commands 和 resources。

---

## 接入主线

s12 在 s11 上累积，是 mini Pi 的最后一版。相对 s11 的变更：

| 组件 | s11 | s12 |
| --- | --- | --- |
| 新增类型 | — | `PackageManifest` / `Package` / `LoadedPackage` |
| 新增函数 | — | `loadPackage` / `installLoadedPackage` / `pick` |
| 主循环 / `ProviderInput` | — | **不变**（纯新增） |

**焊接点**：`loadPackage(pkg)` 按 manifest 从 contents 挑出 tools / commands / resources；`installLoadedPackage(loaded, registry, commands, resources)` 把它们注入既有 `ToolRegistry` / commands / `ResourceLoader`。s01–s11 的全部能力至此收拢成一个完整 mini Pi。

---

## 课程结束

12 节走完，mini Pi 覆盖了这条主线：

```text
s01  Agent Core          接住一轮消息
s02  Tool Contract       工具拆成说明和执行
s03  Provider Event Stream  provider 分段返回事件
s04  Evented Tool Loop   工具请求 → 执行 → 结果回写，循环
s05  Tool Hook Boundary  执行前后留插口
s06  Turn Snapshot       一轮开始先拍快照
s07  Session Tree        历史能分叉
s08  Context Resources   项目资料进入输入
s09  Extension Runtime   外部代码通过 API 接入
s10  Runtime Modes       core 产事件，外层决定展示
s11  Trust and Execution 加载靠 trust，执行靠容器
s12  Package Distribution 能力整理成包分发
```

每一节只加一个机制，机制之间首尾相接。完整的 turn 执行链和总览，见[项目根 README](../README.md)。

---

<details>
<summary>Pi 源码溯源：PiManifest 和三种包源</summary>

教学版用 PackageManifest（名字列表）+ contents（内容字典）+ loadPackage。Pi 的 `packages/coding-agent` 有完整的包管理，支持 npm/git/local 三种来源。

### 源码在哪

- `packages/coding-agent/docs/packages.md` — 包机制官方文档
- `packages/coding-agent/src/core/package-manager.ts:92` — `PackageManager` 接口
- `packages/coding-agent/src/core/package-manager.ts:147` — `PiManifest`
- `packages/coding-agent/src/core/resource-loader.ts:22` — `ResourceLoader`

### PiManifest 的真实形状

教学版的 manifest 是 `{ tools, commands, resources }` 三个名字列表。Pi 的 manifest（`package-manager.ts:147`）声明四类资源的**路径**：

```ts
interface PiManifest {
  extensions?: string[];   // 扩展路径
  skills?: string[];       // skill 路径
  prompts?: string[];      // 提示模板路径
  themes?: string[];       // 主题路径
}
```

放在 `package.json` 的 `pi` 字段里：

```json
{
  "name": "my-package",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  }
}
```

教学版的 tools/commands/resources 对应 Pi 的 extensions/skills/prompts/themes——Pi 没有单独的 "tools" 和 "commands"，它们都由 extension 注册（s09）。

### 三种包来源

教学版的包是内存对象。Pi 的 `PackageManager`（`package-manager.ts:92`）支持三种来源：

```ts
interface PackageManager {
  resolve(onMissing?): Promise<ResolvedPaths>;
  install(source: string, options?): Promise<void>;
  remove(source: string, options?): Promise<void>;
  update(source?): Promise<void>;
}
```

| 来源 | 格式 | 例子 |
| --- | --- | --- |
| npm | `npm:@scope/pkg@1.2.3` | 从 npm 安装 |
| git | `git:github.com/user/repo@v1` | 从 git 仓库 |
| local | `/absolute/path` | 本地路径 |

教学版的 `pick(contents, names)` 是 Pi `resolve` 的极简版——Pi 的 resolve 要解析三种来源、处理依赖、去重，复杂得多。

### glob + 排除 + 强制包含

manifest 的路径支持 glob，还能排除和强制包含：

```json
"extensions": [
  "./extensions/**/*",
  "!extensions/legacy.ts",      // 排除
  "+themes/legacy.json"          // 强制包含（即使被排除规则匹配）
]
```

教学版没有这层路径模式。

### 安全警告

`packages.md` 明确：第三方包拿到的是完全系统访问权限（呼应 s11——Pi 不内置 permission）。装一个 pi 包等于让它跑任意代码，信任靠包来源和 s11 的 trust 机制。

### 一句话

教学版的 PackageManifest 立的是"清单驱动的按需加载"。Pi 把它坐实成 `pi` 字段声明四类资源路径 + npm/git/local 三种来源 + glob 排除规则 + 完整的 install/remove/update 生命周期。教学版用内存对象保留最小路径，但"manifest 是入口、决定哪些内容可见"这个心智一致。

</details>
