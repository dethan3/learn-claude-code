# s07: Session Tree — 历史不是一条线，是一棵树

> *走错了能回头，回头还能换条路。*
> **Pi 边界**：会话历史边界 —— 历史存成一棵树，一轮输入只取当前这条路径。

[上一节：s06](../s06_turn_snapshot/) → `s07` → [下一节：s08](../s08_context_resources/)

---

## 问题

到 s06 为止，消息都存在一个数组里，只能一条线往后加：A → B → C。

但现实里经常想这样：走到 B，发现不太对，想退回 A 换个方向再试一次。数组做不到——它只会往后追加，没有"回到某个点、从那里分叉"。

s07 要让历史能**分叉**。

---

## 解决方案

给每条消息记一个 `parentId`，指向它的上一条。这样历史不再是一条线，而是一棵树：同一个节点可以长出多条分支。

```text
        user(方案A)
        /        \
  asst(A的回答)  asst(改走方案B)
```

`currentPath` 从当前位置一路回溯到根，得到**当前这条线**的消息序列——provider 拿到的还是线性的消息，对外完全没变。`moveTo` 切换当前位置，就能走到另一条分支。

注意：s07 不是让 provider 理解一棵树。树只存在于 core 内部，用来支持回到历史点再分叉；provider 仍然只看当前路径上的线性 messages。

> **[U1 升级]** `AgentState.messages`（数组）升级为 `SessionTree`。这是受控升级：数组没法表达分叉，所以是替换。但 `currentPath()` 仍产出线性 `AgentMessage[]`，ProviderInput 的构造方式一字不变——升级藏在 core 内部，不漏到外面。

---

## 工作原理

**先定义节点。** 一个节点就是一条消息，外加它在树里的位置。

```ts
export type SessionEntry = {
  id: string;
  parentId: string | null;
  message: AgentMessage;
};
```

**SessionTree 做三件事。** 追加、切换位置、读当前路径。

```ts
export class SessionTree {
  private entries = new Map<string, SessionEntry>();
  private activeLeafId: string | null = null;
  private counter = 0; // 实例级：每个树独立计数

  append(message: AgentMessage): SessionEntry {
    const entry = { id: `e${++this.counter}`, parentId: this.activeLeafId, message };
    this.entries.set(entry.id, entry);
    this.activeLeafId = entry.id;
    return entry;
  }

  moveTo(entryId: string): void { /* 切换当前位置 */ }

  currentPath(): AgentMessage[] {
    // 从 activeLeaf 一路回溯到根，反转，得到当前这条线
  }
}
```

`append` 总是接在当前位置后面；`moveTo` 把当前位置挪到任意已有节点（分叉的起点）；`currentPath` 回溯出当前这条线。切位置不会删掉旧节点——它们还在树里，只是不在当前路径上。

**id 计数器是实例级的**（`this.counter`），不是全局变量。这样多个 SessionTree 互不干扰，也不会因为新建一个树就接着旧树的编号往后数。

**对外不变。** `createTurnSnapshot` 和 `buildProviderInputFromSnapshot` 现在从 `state.session.currentPath()` 取消息，但产出的还是线性的 ProviderMessage[]——provider 这边感觉不到 core 内部已经从数组换成了树。

> 这一节真正建立的是**会话历史边界**：历史在 core 内部是一棵树，但对一轮输入来说，它永远是"当前这条路径"的线性投影。后面 s08 会往输入里加项目资料，但"历史 = 当前路径"这条规矩，从这里立起来。

---

## 试一下

运行：

```sh
npm run s07
```

输出类似：

```text
s07: Session Tree

[路径：方案 A]
user: 方案 A
assistant: A 的回答

[路径：方案 B]
user: 方案 A
assistant: 改走方案 B

[所有节点]
e1 parent=null user: 方案 A
e2 parent=e1 assistant: A 的回答
e3 parent=e1 assistant: 改走方案 B
```

观察重点：`e2` 和 `e3` 的 parent 都是 `e1`——从同一个节点分叉出两条路；切到方案 B 后，`[路径：方案 B]` 只含 `e1` 和 `e3`，不含 `e2`。

---

## 接入主线

s07 在 s06 上累积。相对 s06 的变更：

| 组件 | s06 | s07 |
| --- | --- | --- |
| `AgentState` | `{ messages: AgentMessage[] }` | **`{ session: SessionTree }`**（U1 升级） |
| 新增类型 | — | `SessionEntry` / `SessionTree` |
| 消息写入 | `state.messages.push(...)` | `state.session.append(...)` |
| 消息读取 | `state.messages` | `state.session.currentPath()` |
| `createTurnSnapshot` / `buildProviderInputFromSnapshot` | 从 `state.messages` 取 | 从 `state.session.currentPath()` 取 |
| `ProviderInput` 构造 | — | **不变**（currentPath 产出线性消息） |

**焊接点**：消息读写全改为走 `state.session`；但 `currentPath()` 产出线性 `AgentMessage[]`，所以 ProviderInput / TurnSnapshot 的构造逻辑一字未动。U1 升级藏在 core 内部。

---

## 接下来

现在一轮输入里有：当前路径上的历史、工具说明、模型名。

下一节会再往输入里加一样东西——项目本身的资料（比如一份说明文档、一个可复用的提示词）。

进入下一节：[s08](../s08_context_resources/)。

---

<details>
<summary>Pi 源码溯源：持久化的 SessionTree 和 11 种 entry</summary>

教学版的 SessionTree 在内存里、只有 message entry。Pi 的 session 是**持久化**的树，节点有 **11 种类型**，远不止消息。

### 源码在哪

- `packages/agent/src/harness/types.ts:334` — SessionTreeEntry 联合类型
- `packages/agent/src/harness/types.ts:409` — 11 种 entry
- `packages/agent/src/harness/session/session.ts:82` — Session 实现
- `packages/agent/src/harness/session/session.ts:246` — `moveTo`（分支）

### 不只是消息：11 种 entry

教学版的 SessionEntry 只有 `{ id, parentId, message }`。Pi 的 entry 是个大联合（`types.ts:409`）：

```ts
type SessionTreeEntry =
  | MessageEntry              // 消息（教学版唯一有的）
  | ThinkingLevelChangeEntry  // 改了推理强度
  | ModelChangeEntry          // 换了模型
  | ActiveToolsChangeEntry    // 启用/禁用了工具
  | CompactionEntry           // 做了上下文压缩（s08 方向）
  | BranchSummaryEntry        // 分支摘要
  | CustomEntry / CustomMessageEntry  // 自定义内容
  | LabelEntry                // 给某个节点打标签
  | SessionInfoEntry          // 会话元信息
  | LeafEntry;                // 当前活跃叶子
```

历史不只记"说了什么"，还记"中途换了什么"——换模型、换工具、压缩上下文都是树上的节点。这样回到任何一个历史点，能完整还原当时的配置。

### parentId + moveTo = 真分叉

每个 entry 都有 `parentId`（`types.ts:337`），`moveTo(entryId)`（`session.ts:246`）切换当前位置：

```ts
async appendMessage(message) {
  return this.appendTypedEntry({
    type: "message", id: ...,
    parentId: await this.storage.getLeafId(),   // 挂在当前叶子下
    timestamp: ..., message,
  });
}
```

新节点总挂在当前叶子下；`moveTo` 把叶子指针挪到任意历史节点，再 append 就长出一条新分支。和教学版的 SessionTree 一模一样的心智，但 Pi 的分支还能带 `BranchSummaryEntry` 记录"为什么岔出去"。

### 持久化，不是内存

教学版的 SessionTree 在内存里、进程退出就没了。Pi 的 session 走 `storage`（`session.ts`），落盘持久化——关掉重开能恢复，能跨会话。`LeafEntry` 专门跟踪"当前在哪条分支"，持久化后重启能接上。

### 边界

`moveTo` 一个不存在的 id 抛 `SessionError`（教学版也抛错，一致）。分支不会删旧节点——它们留在树里，只是不在当前路径上。

### 一句话

教学版的 SessionTree 立的是"历史是树、能分叉、一轮输入取当前路径"。Pi 把它坐实成持久化的树 + 11 种 entry（消息/模型变更/工具变更/压缩/分支摘要…），parentId + moveTo 实现分叉。教学版只留 MessageEntry 和分支骨架。

</details>
