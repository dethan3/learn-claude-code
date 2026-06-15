# s08: Context Resources — 项目资料进入 systemPrompt

> *不光听用户说，还得带上项目自己的规矩。*
> **Pi 边界**：上下文资源边界 —— 项目资料组装进 systemPrompt，和对话历史分开。

[上一节：s07](../s07_session_tree/) → `s08` → [下一节：s09](../s09_extension_runtime/)

---

## 问题

到 s07 为止，一轮输入里有历史、有工具说明。但 provider 还看不到**项目本身的资料**：一份编码规范、一个可复用的提示词、一段领域说明。

这些东西不是用户刚刚说的话，但会影响 provider 怎么回答。比如用户问"总结一下这个项目"，provider 如果知道"这个项目要求简洁的工程说明"，回答会不一样。

要是把这些硬编码进代码，每换一个项目就得改 core。需要一个地方统一装这些资料，再注入到输入里。

s08 就做这件事——而且对齐 Pi 的做法：**把资料组装进 `systemPrompt`**（provider 的标准字段），而不是另造一个独立字段。

---

## 解决方案

引入 `ContextResource`：一份项目资料。它有三类来源：

| kind | 是什么 | 例子 |
| --- | --- | --- |
| `agents` | 项目级的规矩 | `AGENTS.md`（编码规范） |
| `skill` | 一段可复用的能力说明 | `repo-review` |
| `prompt` | 一个提示词模板 | `summarize` |

`ResourceLoader` 负责加载它们，`buildSystemPrompt` 把它们拼成一段文本，**装进 `ProviderInput.systemPrompt`**。

注意：`systemPrompt` 是和 `tools` **并列新增**的字段（tools 保留，R1）。ProviderInput 现在是 `{ systemPrompt, messages, tools }`——这正是 Pi 的 `Context` 形状。

---

## 工作原理

**先定义资源。** 一份资料带三件事：来源类型、名字、内容。

```ts
export type ContextResource = {
  kind: "agents" | "skill" | "prompt";
  name: string;
  content: string;
};
```

**用一个加载器装起来。** `ResourceLoader.load()` 返回资源的拷贝（不直接交出内部数组）。

```ts
export class ResourceLoader {
  constructor(private resources: ContextResource[]) {}
  load(): ContextResource[] {
    return this.resources.map((resource) => ({ ...resource }));
  }
}
```

**拼成 systemPrompt。** `buildSystemPrompt` 每份资料带上来源标记，用空行隔开。

```ts
export function buildSystemPrompt(resources: ContextResource[]): string {
  return resources
    .map((r) => `[${r.kind}:${r.name}]\n${r.content}`)
    .join("\n\n");
}
```

**塞进 ProviderInput。** `systemPrompt` 是 provider 的标准字段；`createTurnSnapshot` 多接收一个 loader，把 systemPrompt 一并拍进快照。

```ts
export type ProviderInput = {
  systemPrompt: string;   // s08 新增：项目资料组装进去（对齐 Pi Context.systemPrompt）
  messages: ProviderMessage[];
  tools: ToolSpec[];      // s02 起，保留（R1）
};
```

> 这一节真正建立的是**上下文资源边界**：项目资料作为 `systemPrompt` 进入输入（system 级），和 `messages`（对话级）分开。对齐 Pi——它也是把 AGENTS.md/skills 组装进 `systemPrompt`，没有独立的 context 字段。后面 s11 会按信任程度决定要不要加载这些资源。

---

## 试一下

运行：

```sh
npm run s08
```

输出类似：

```text
s08: Context Resources

[resources]
agents: AGENTS.md
skill: repo-review
prompt: summarize

[provider input]
systemPrompt blocks: 3
messages: 1
tools: 1

[systemPrompt]
[agents:AGENTS.md]
Use concise engineering explanations.

[skill:repo-review]
Inspect package.json first. Then summarize risks.

[prompt:summarize]
Return three bullets and one next step.
```

观察重点：`[provider input]` 里 systemPrompt、messages、tools 三样都在——systemPrompt 是并列加进来的，没挤掉 tools；`[systemPrompt]` 是三份资源拼出来的完整文本。

---

## 接入主线

s08 在 s07 上累积。相对 s07 的变更：

| 组件 | s07 | s08 |
| --- | --- | --- |
| `ProviderInput` | `{ messages, tools }` | `{ systemPrompt, messages, tools }`（加 systemPrompt，对齐 Pi Context） |
| `TurnSnapshot` | 两字段 | 加 `systemPrompt` |
| 新增类型 | — | `ContextResource` |
| 新增类/函数 | — | `ResourceLoader` / `buildSystemPrompt` |
| `createTurnSnapshot` | `(state, registry)` | 多一个 `loader` |

**焊接点**：`createTurnSnapshot` 调 `buildSystemPrompt(loader.load())` 把 systemPrompt 拍进快照；`buildProviderInputFromSnapshot` 把 `snapshot.systemPrompt` 放进 ProviderInput。tools 自始至终保留。

---

## 接下来

现在 core 的能力（工具、资源）都写死在 core 里。每加一种新玩法都得改 core。

下一节会让外部代码通过一个公开的 API 接入 core，core 不用动就能长出新能力。

进入下一节：[s09](../s09_extension_runtime/)。

---

<details>
<summary>Pi 源码溯源：system prompt 的运行时组装</summary>

教学版把资源拼成 systemPrompt 塞进 ProviderInput。Pi 的 `packages/coding-agent` 有完整的资源发现 + system prompt 组装管线。

### 源码在哪

- `packages/coding-agent/src/core/resource-loader.ts` — `DefaultResourceLoader`（资源发现）
- `packages/coding-agent/src/core/resource-loader.ts:28` — `buildSystemPrompt`（system 组装）
- `packages/coding-agent/src/core/resource-loader.ts:79` — `loadProjectContextFiles`（AGENTS.md 发现）

### 五类资源

教学版只有一类 `ContextResource`。Pi 的 `ResourceLoader` 发现五类：

| 类型 | 是什么 | 发现方式 |
| --- | --- | --- |
| context files | AGENTS.md / CLAUDE.md | 从 cwd 向上找（`loadProjectContextFiles`） |
| skills | SKILL.md | `.pi/skills/` + 包 |
| prompt templates | 提示模板 | `.pi/prompts/` |
| themes | UI 主题 | `.pi/themes/` |
| system prompt | 自定义 base | 配置 |

教学版的 `kind: "agents" | "skill" | "prompt"` 是这五类的子集。

### AGENTS.md 的发现规则

`loadProjectContextFiles`（`resource-loader.ts:79`）按候选名 + 向上查找：

```ts
const candidates = ["AGENTS.md", "AGENTS.MD", "CLAUDE.md", "CLAUDE.MD"];
// 从 cwd 逐级向上找，项目级优先于全局级
```

不只看当前目录，还往祖先目录找——monorepo 里每一层都能放 AGENTS.md，层层叠加。

### system prompt 的组装顺序

`buildSystemPrompt`（`resource-loader.ts:28`）按固定顺序拼：

```text
1. base system prompt（如果自定义）
2. 项目上下文文件（AGENTS.md 内容）
3. 可用技能列表（formatSkillsForPrompt）
4. APPEND_SYSTEM.md（追加的系统提示）
5. 日期 + 工作目录信息
```

教学版用 `buildSystemPrompt` 把资源拼成一段 `[kind:name]\ncontent`——是这里第 2、3 步的极简版。Pi 的 system prompt 是**运行时组装**的，不是硬编码——换项目、换工具，拼出来的 prompt 就不同。

### 加载顺序有讲究

`DefaultResourceLoader.reload` 先加载扩展（s09），再加载其他资源——因为扩展能注册新的资源路径，必须先让扩展跑完。最后才加载 context files。教学版没有这个依赖顺序（资源都是内存写死的）。

### 边界

- 资源缺失：通过 `ResourceDiagnostic` 报告但继续跑，不崩。
- 循环加载：`canonicalizePath` + `Set` 去重，已加载路径跳过。
- 单个资源失败：错误隔离，不影响其他资源。

### 一句话

教学版立的是"项目资料组装进 systemPrompt"（对齐 Pi 的 `Context.systemPrompt`）。Pi 把它坐实成五类资源的运行时发现 + 按固定顺序组装。教学版用内存数据保留最小路径，但"system prompt 运行时组装"这个核心心智一致。

</details>
