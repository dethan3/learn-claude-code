# 累积演进宪法

> 本文件是 `learn-pi-agent` 的工程对照基准。每一节的 `code.ts` 和 `README.md` 都必须对照它。
> 目标：学习者从 s01 学到 s12，**累积**实现出一个机制健全、心智与 Pi 一致的 mini Pi。

---

## 0. 核心立场

现有课程确立了「每节独立、最小化」（P2），但丢了「累积实现」（P0）。
本宪法把 P0 立起来，同时不毁掉「每节聚焦一个机制」的教学性。

**一句话原则：每一节 = 给正在生长的 mini Pi 装一个零件。**
- 代码是单轨累积的：`sXX/code.ts` 是 mini Pi 的第 N 个版本，是第 N-1 节的**超集**。
- 文档负责聚焦：每节 README 末尾的「接入主线」段用 diff 风格展示本节焊上了什么零件。

不维护「聚焦 demo」和「主线」两份代码。两份代码必然漂移，漂移就是现在所有类型退化问题的根源。

---

## 1. 元规则（约束所有类型演化）

| 规则 | 内容 | 修复的现有问题 |
|---|---|---|
| **R1** | 字段**只增不删**：`ProviderInput`、`ProviderEvent`、`StopReason` 取值集、`AgentMessage` union 成员、`ToolSpec`、`TurnSnapshot` 字段，一旦引入永久保留 | s03 删 tools、s04 删 message_start、s06/s08 删 stopReason、s04/s06 删 ToolSpec.input |
| **R2** | 方法**只增**：`ToolRegistry` 等类的成员只增 | registry 在 s02/s04/s06 间反复变方法集 |
| **R3** | 只允许两类**受控升级**，且必须在当节 README 显式声明「这是升级，不是新增」：<br>**U1 接口语义升级**（不可避免的 breaking change）<br>**U2 同名类型全局唯一** | 现有「同名不同义」「5 节 5 种 Tool 形状」 |
| **R4** | 错误**不崩溃**，转结构化消息（见 §4） | Gap3 错误传播缺失 |
| **R5** | 循环有**终止保证**（`maxTurns` 上限） | Gap3 工具循环无保护 |
| **R6** | **加载**和**执行**分开管（对齐 Pi 真实设计）：trust 控制资源加载；执行边界不内置、靠部署层 containerization；hook 是唯一的执行细化拦截点 | Gap3 trust/policy/hook 三个孤立 demo |
| **R7** | core 通过 **output 抽象**输出，不直接 `console.log`。从 s01 起就有最小间接层 | Gap3 输出/执行分离，s10 才分离却已焊死 |
| **R8** | 每节 `code.ts` 是前一节的超集；README「接入主线」段以 diff 展示增量 | 不累积 |

### U1 受控升级清单（宪法允许的全部 breaking change）

| 节 | 升级 | 理由 |
|---|---|---|
| s03 | `Provider.complete()` → `Provider.stream()` | provider 输出形态本质改变（一次性→流式），无法并存 |
| s07 | `AgentState.messages: AgentMessage[]` → `SessionTree` | 历史从线性升级为可分支树；`currentPath()` 仍产出 `AgentMessage[]`，对外构造方式不变 |
| s11 | `ResourceLoader.load()` → `load(trust)` | 加信任参数过滤资源（参数升级） |

除以上三处外，**任何**对已有类型/接口的删改都违反宪法。

### U2 同名类型全局唯一清单

`ResourceLoader`、`RuntimeEvent`、`Tool`、`Output` 在主线中各自**只有一个定义**，所有章节复用它。

---

## 2. 核心类型字典

> 终态定义 + 引入节 + 演变。每节 `code.ts` 必须与字典一致。

```ts
// —— 消息（s01 起，union 只增 R1）——
type StopReason = "stop" | "error";              // s01
//           = "stop" | "toolUse" | "error";     // s04 起加 toolUse，之后稳定

type UserMessage      = { role: "user";       content: string };                       // s01，稳定
type AssistantMessage = { role: "assistant";  content: string; stopReason: StopReason };// s01，stopReason 永驻
type ToolResultMessage= { role: "toolResult"; toolCallId: string; content: string };    // s04，稳定
type AgentMessage = UserMessage | AssistantMessage            // s01
                  | ToolResultMessage;                        // s04 起并入（只增）

// —— core 状态（对齐 Pi AgentState）——
type AgentState = {
  messages: AgentMessage[];   // s01 起；s07 升级为 SessionTree（U1）
  model: string;              // s06 起加：跨轮配置，对齐 Pi（不在 ProviderInput/snapshot）
};

// —— Provider 对外形态（对齐 Pi Context）——
type ProviderMessage =
  | { role: "user" | "assistant"; content: string }           // s01
  | { role: "toolResult"; toolCallId: string; content: string };// s04 起并入（只增）

// Pi 的 Context = { systemPrompt?, messages, tools }。教学版对齐：systemPrompt(s08 起) + messages + tools。model 不在这里，在 AgentState。
type ProviderInput = {
  systemPrompt: string;                                        // s08 起加（项目资料组装进去）
  messages: ProviderMessage[];                                 // s01
  tools: ToolSpec[];                                           // s02 起加（s03 不许删）
};

// —— 工具契约（s02 起，全局唯一形状 U2）——
type ToolSpec    = { name: string; description: string; input: Record<string, string> };// input 永驻
type ToolHandler = (input: Record<string, string>) => string;                          // 同步；抛错由 R4 捕获
type Tool        = { spec: ToolSpec; handler: ToolHandler };                           // 全局唯一形状
type ToolCall    = { id: string; name: string; input: Record<string, string> };        // s04

class ToolRegistry {                                           // 方法只增 R2
  register(tool: Tool): void {}                                // s02
  getSpecs(): ToolSpec[] {}                                    // s02
  run(call: ToolCall): string {}                               // s04
}

// —— Provider 事件流 ——
type ProviderEvent =
  | { type: "message_start" }                                  // s03（s04 不许删）
  | { type: "text_delta"; text: string }                       // s03
  | { type: "message_end"; stopReason: StopReason }            // s03
  | { type: "tool_call"; call: ToolCall };                     // s04 起加

interface Provider {                                           // U1：s03 由 complete 升级为 stream
  stream(input: ProviderInput): AsyncGenerator<ProviderEvent>;
}

// —— Turn 快照（对齐 Pi AgentContext：固定 systemPrompt/messages/tools；model 在 state 不进快照）——
type TurnSnapshot = { systemPrompt: string; messages: ProviderMessage[]; tools: ToolSpec[] };

// —— 会话树（U1：s07 取代扁平 messages 数组）——
type SessionEntry = { id: string; parentId: string | null;
                      role: "user" | "assistant" | "toolResult"; content: string };
class SessionTree {
  append(msg): SessionEntry {}
  moveTo(id: string): void {}
  currentPath(): AgentMessage[] {}                             // 产出线性消息供 ProviderInput 使用
  allEntries(): SessionEntry[] {}
}

// —— 上下文资源（s08，U2 全局唯一 ResourceLoader）——
type ContextResource = { kind: "agents" | "skill" | "prompt"; name: string; content: string };
class ResourceLoader {
  constructor(private resources: ContextResource[]) {}
  load(trust?: ProjectTrust): ContextResource[] {}             // U1：s11 加 trust 参数
}
// s08：资源组装进 systemPrompt（对齐 Pi buildSystemPrompt），不是独立 context 字段
function buildSystemPrompt(resources: ContextResource[]): string {}

// —— Hook（s05，外层装饰 registry.run，不进 registry）——
type BeforeToolCallResult = { type: "allow" } | { type: "block"; reason: string };
type ToolHooks = {
  beforeToolCall?: (call: ToolCall) => BeforeToolCallResult;
  afterToolCall?:  (call: ToolCall, result: string) => string;
};
function executeToolCall(registry, hooks, call): ToolResultMessage {}  // s05 起，稳定（不加 policy）

// —— 扩展运行时（s09，复用前面的 Tool/ToolRegistry）——
type Command = { name: string; run: () => string };
type RuntimeEvent = { type: "message"; content: string } | { type: "done" }; // U2 全局唯一
type ExtensionAPI = {
  on(type: RuntimeEvent["type"], handler: (e: RuntimeEvent) => void): void;
  registerTool(tool: Tool): void;                              // 复用 s02 的 Tool，注入现有 ToolRegistry
  registerCommand(cmd: Command): void;
};
type Extension = (api: ExtensionAPI) => void;
class ExtensionRuntime { use(ext: Extension): void; /* 内部持有 ToolRegistry */ }

// —— 输出抽象（R7：s01 最小形态 → s10 正式化）——
type Output = { log(line: string): void };                     // s01 起最小间接层
// s10 升级为：
type RuntimeMode = { render(events: RuntimeEvent[]): void };   // PrintMode / JsonMode 是两个实现

// —— 信任与执行边界（s11，对齐 Pi：trust 控加载，执行靠 containerization）——
type ProjectTrust = "trusted" | "untrusted";
// 注：Pi 不内置执行权限系统。ExecutionPolicy/Executor 已移除——执行边界靠部署层
// containerization 三方案（OpenShell / Gondolin / Plain Docker），core 内只有 trust 控制资源加载。

// —— 能力分发（s12，注入既有 registry/commands/loader）——
type PackageManifest = { name: string; tools: string[]; commands: string[]; resources: string[] };
type Package = { manifest: PackageManifest; contents: Record<string, string> };
type LoadedPackage = { name: string; tools: Record<string,string>;
                       commands: Record<string,string>; resources: Record<string,string> };
function loadPackage(pkg: Package): LoadedPackage {}
```

---

## 3. 十二节累积演进主表

> 每节三栏：**累积骨架（不变）** ｜ **本节新增零件** ｜ **接入点（焊在哪）**

| 节 | 累积骨架（不变） | 本节新增零件 | 接入点 |
|---|---|---|---|
| **s01** | — | AgentState、消息三类型、StopReason(stop/error)、ProviderInput{messages}、Provider.complete、runOneTurn、`Output.log`(R7) | 地基 |
| **s02** | messages、provider、runOneTurn | ToolSpec{name;description;**input**}、ToolHandler、Tool、ToolRegistry(register/getSpecs) | buildProviderInput 接收 registry；ProviderInput 加 `tools=registry.getSpecs()` |
| **s03** | 全部（**含 tools，R1 不删**） | **[U1]** Provider complete→stream、ProviderEvent(message_start/text_delta/message_end)、collectAssistantMessage | Provider 接口升级；runOneTurn 内 complete→stream+collect |
| **s04** | 事件流、tools | ToolCall、ToolResultMessage、tool_call 事件、StopReason+toolUse、ToolRegistry.run、runEventedToolLoop(**maxTurns** R5)、错误捕获(R4) | 循环内 `registry.run(call)`，结果入 messages；tools 仍取 `registry.getSpecs()`（**不硬编码**） |
| **s05** | 工具循环 | ToolHooks、beforeToolCall/afterToolCall、BeforeToolCallResult(allow/block)、executeToolCall(registry,hooks,call) | 循环内 `registry.run(call)` → `executeToolCall(registry,hooks,call)`；registry 不变(R2) |
| **s06** | 循环+hook | TurnSnapshot{messages,tools}、createTurnSnapshot、**AgentState+model**（跨轮配置，对齐 Pi） | runEventedToolLoop 开头先 createTurnSnapshot；model 在 AgentState 不进 snapshot（对齐 Pi AgentContext，snapshot 只固定 messages/tools） |
| **s07** | snapshot、循环、hook | **[U1]** messages 数组→SessionTree、SessionEntry{parentId}、append/moveTo/currentPath | buildProviderInput 用 `session.currentPath()` 取线性消息；对外构造不变 |
| **s08** | tree、snapshot、tools | ContextResource、ResourceLoader.load()、buildSystemPrompt、ProviderInput+**systemPrompt**（资料组装进去，对齐 Pi；tools 保留 R1） | buildProviderInput 调 buildSystemPrompt(loader.load()) 拼 systemPrompt；snapshot 跟随加 systemPrompt |
| **s09** | 全部主线 | Extension、ExtensionAPI、ExtensionRuntime、Command、RuntimeEvent、on/registerTool/registerCommand | ExtensionRuntime 内部持有现有 ToolRegistry；registerTool 注入的 Tool 走同一执行链(s05 hook) |
| **s10** | 全部主线 | **[R7 收获]** Output.log → RuntimeMode、PrintMode/JsonMode、render(RuntimeEvent[]) | core 的 `output.log` 升级为 `mode.render(events)`；s01 起就没直连 console，此处只是命名+多态化 |
| **s11** | 全部主线 | ProjectTrust、**[U1]** load(trust)、containerization 三方案（执行边界靠部署层，对齐 Pi） | trust→`loader.load(trust)` 控制资源加载；执行边界不内置，靠 containerization（README 讲 OpenShell/Gondolin/Docker 三方案） |
| **s12** | 全部主线 | PackageManifest、Package、LoadedPackage、loadPackage、pick | loadPackage 产出注入 registry(s02)/commands(s09)/loader(s08)。能力分发闭环 |

---

## 4. Gap3 健全心智补全（宪法硬规定）

| 缺口 | 宪法规定 |
|---|---|
| **循环终止** (R5) | `runEventedToolLoop` 加 `maxTurns`（默认 **8**）。终止条件 = provider 不再发 tool_call **或** stopReason≠toolUse **或** 达上限。达上限时返回 stopReason=`"stop"` 并附注 "max turns reached" |
| **错误传播** (R4) | ① provider stream 抛错 → 捕获，本轮 AssistantMessage.stopReason=`"error"`、content=错误说明，写回 state。<br>② tool handler 抛错 → `executeToolCall` 捕获，ToolResultMessage.content=`"error: <msg>"`，**循环继续**（让 provider 看到错误自行决定）。<br>StopReason 维持三值 `stop|toolUse|error`，不为错误新增类型 |
| **加载/执行分离** (R6) | 两件事分开（对齐 Pi 真实设计）：<br>• **加载**靠 trust：`loader.load(trust)`，untrusted 返回空（防恶意资源）<br>• **执行**不内置权限：Pi 不在 core 里限制文件/进程/网络，执行边界靠部署层 containerization 三方案（OpenShell / Gondolin / Plain Docker）<br>• **细化拦截**靠 hook：beforeToolCall allow/block 具体工具（core 内唯一的执行拦截点）<br>教学版不再发明 ExecutionPolicy——它在 Pi 里没有对应物 |
| **systemPrompt 层级** | `ProviderInput.systemPrompt` 是 **system 级**装配（项目资料组装进去），与 `messages`（**对话级**历史）是两个独立维度。对齐 Pi 的 `Context.systemPrompt`（资料进 systemPrompt，不是独立 context 字段） |
| **输出/执行分离** (R7) | 从 s01 起 core 通过 `Output.log` 输出，不直连 console；s10 升级为 `RuntimeMode.render`。前 9 节就不存在"core 与 IO 焊死"的债 |

---

## 5. 完整 Turn 执行链（总装蓝图）

> 这是根 `README.md`（总装章）的灵魂。一条链接上全部 12 节 + Gap3。

```text
newTurn(userInput):
  1. systemPrompt = buildSystemPrompt(loader.load(trust)) # s08 资源组装 + s11 trust 过滤 (R6)
  2. session.append({role:"user", content:userInput})     # s07 历史树 (U1)
  3. snapshot = createTurnSnapshot(                        # s06 快照
       session.currentPath(), registry.getSpecs(), systemPrompt)
     # model 在 AgentState，不进 snapshot（对齐 Pi AgentContext）
  4. for turn in 0..maxTurns:                              # s04 循环 (R5)
       input  = buildProviderInput(snapshot, state)        # s01/s02/s08；systemPrompt 从 snapshot，model 从 state
       events = provider.stream(input)                     # s03 事件流 (U1)（Pi 真实 stream(model,context)，教学 fake provider 简化）
       for event in events:
         message_start / text_delta → 累加 content
         message_end               → stopReason
         tool_call →
           result = executeToolCall(                       # s05 hook（R4 错误捕获）
                       registry, hooks, call)              # 无 policy（执行边界靠 containerization，R6）
           session.append(toolResultMessage)               # s07
       if 无 tool_call 或 stopReason≠toolUse: break
  5. assistant = {role:"assistant", content, stopReason}  # stopReason 永驻 (R1)
  6. session.append(assistant)                            # s07
  7. mode.render(allEvents)                               # s10 输出分离 (R7)

  旁路：extension(s09) 可注册额外 tool/command；
        package(s12) 可分发 tool/resource 注入 registry/loader。
```

每一步都能追溯到某一节 + 某条规则。这就是「心智健全」的可验证证据。

---

## 6. 文件结构与每节 README 规范

### 6.1 文件结构

```text
learn-pi-agent/
  README.md       总装章：执行链全景图（§5）+ 累积演进表索引（§3）+ 如何从 s01 读到 s12
  EVOLUTION.md    本文件（宪法）
  sXX_*/
    code.ts       累积主线第 N 版（前一节的超集，R8）
    README.md     按下方规范
```

### 6.2 每节 README 模板

```text
# sXX: <主题> — <一句话点题>
> <motto 格言>
> Pi 边界：<本节对应的设计边界>

## 问题          ← 真痛点 / 上一节方案的缺陷（不提前命名下节概念）
## 解决方案      ← 核心洞察 + 设计取舍表（不重复工作原理步骤）
## 工作原理      ← 递进叙事：每步「为什么需要 + 代码」，末尾点睛
## 试一下        ← 运行命令 + 输出 + 观察重点
## 接入主线      ← 相对上节的变更表（前后对比）+ 焊接点
## 接下来        ← 引出下一节痛点（只描述，不命名）
## Pi 源码溯源    ← 折叠，只对照本章词汇
```

### 6.3 写作规则（硬约束）

- **R-写①「问题」必须有痛或张力**：场景痛点 或 上一节方案的缺陷。不准写任务描述（"core 要保存对话"这种不算问题）。
- **R-写②「解决方案」是洞察不是目录**：一句话说清本质 + 设计取舍表。不准预告实现步骤（那是「工作原理」的事）。
- **R-写③「工作原理」是叙事不是清单**：每个类型/函数出场时回答"为什么现在需要它"，递进展开，末尾必点睛（这一节真正交付的东西是什么）。U1 升级必须显式标注「这是升级」。
- **R-写④ 用自然中文，不直译英文意象**：motto 若源自英文，中文必须重写（`catch one turn` ✗ → 不译成"接住一轮"）；不为对仗生造动词搭配（"穿过 core""接住一轮"）；用程序员实际会说的词（"存下来""转成"）。每节写完通读一遍，读起来"像翻译"的句子都要改。
- **R-写⑤ 词汇纪律（叙事段）**：「问题」「解决方案」「工作原理」「接下来」只用本章已解释词汇；不提前命名下节概念；"本章不讲 X"也把 X 引进来了，不要写。源码溯源同样控词。
  - **例外**：「接入主线」段是工程对照表，允许路标式提及未来章节的术语，但必须标注出现章节（如 `ToolResultMessage（s04 加）`），作为前瞻路标，不是教学展开。

### 6.4「接入主线」段的写法

用**变更表**（组件维度，前节 vs 本节），再加一句**焊接点**（本节零件焊在主线的哪个位置）。s01 作为地基节无前节可比，改列「本节确立的永驻基础 + 后续怎么演化」。后续节严格用「变更表 + 焊接点」。

---

## 7. 已落实的修正

- **R1**：s03 保留 tools；s04 保留 message_start、ToolSpec.input，并从 registry.getSpecs() 取 tools；s06/s08 保留 stopReason；s08 的 systemPrompt 与 tools 并列进入 ProviderInput。
- **R2**：s04 之后的 ToolRegistry 统一为 `register + getSpecs + run`。
- **U2**：ResourceLoader、RuntimeEvent、Tool 全链路保持单一形状；后续章节复用同名类型，不另起含义。
- **U1**：s03、s07、s11 的三处受控升级在 README 的「接入主线」中显式标注。
- **R4/R5/R6/R7**：工具错误转 ToolResultMessage、工具循环有 maxTurns、trust 只控加载、输出从 s01 起经过 Output 并在 s10 长成 RuntimeMode。
- **R8**：每节 code.ts 是前一节的超集；每节 README 都有「接入主线」段。
- **幽灵名词**：`toProviderMessage`、`ContextBlock` 这类文档里出现但代码里没有的名词已移除或落到实际实现上。

## 8. 待继续检查的点

- **s10 事件源**：本节按教学 A 方案使用 `createDemoRuntimeEvents()` 作为最小事件源，避免重讲完整 tool loop。后续如果读者仍误解为另起 core，再把「演示事件源」说明前移到「问题」段。
- **s12 安装闭环**：本节按教学 A 方案保留 `tools / commands / resources` 三类教学对象，并通过 `installLoadedPackage()` 接回主线。真实 Pi 的 `extensions / skills / prompts / themes` 只在源码溯源里讲，不进入教学主线。
- **s06/s07 心智负担**：snapshot 与 SessionTree 是课程里的两次陡坡，后续润色时优先看这两节的「问题」段是否足够具体。
