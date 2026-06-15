# learn-pi-agent

一套 Agent Harness 工程课程。用 TypeScript 从零**累积**实现一个机制健全、心智与 Pi 一致的 mini Pi。

12 节，每节只加一个机制。每节的 `code.ts` 是前一节的超集——学完 s12，你手里有一个完整可运行的 mini Pi，而不是 12 个互不相连的玩具。

---

## mini Pi 的一轮，长什么样

12 个机制不是 12 个零件，是一台机器。下面是完整的一轮（turn）执行链——每一步都标注了它来自哪一节：

```text
newTurn(userInput, trust):

  1. 按信任加载项目资料，组装进 systemPrompt
     systemPrompt = buildSystemPrompt(loader.load(trust))   ← s08 资源 + s11 trust

  2. 用户消息进入历史树
     session.append(user message)                           ← s07 历史树

  3. 一轮开始，拍快照（systemPrompt / tools 固定；model 在 state）
     snapshot = createTurnSnapshot(session, registry,
                                    loader, trust)          ← s06 快照

  4. 工具循环（上限 maxTurns）
     while 未结束:                                          ← s04 循环 + R5 终止
       input  = buildProviderInput(snapshot, state)         ← s01/s02/s08；model 从 state
       events = provider.stream(input)                      ← s03 事件流
       for event in events:
         tool_call → executeToolCall(registry, hooks, call) ← s05 hook（出错不崩 R4）
                        before → handler → after
         text_delta → 累加文本
       若本轮无 tool_call → 跳出循环

  5. assistant 消息进入历史树
     session.append(assistant)                           ← s07

  6. 输出（core 产事件，mode 决定怎么展示）
     mode.render(events)                                 ← s10 运行方式

  旁路：
     extension 通过 API 注册 tool / command              ← s09
     package 把一组能力打包、按清单分发                  ← s12
```

这一条链就是 mini Pi 的"心智"。每个机制都接在前一个上——加载、历史、快照、循环、执行、边界、输出，首尾相接。

注意：trust 只决定项目资料是否加载；执行权限不在 core 内解决，系统级边界交给容器或沙箱。

---

## 12 节累积演进

每节只加一个机制，`code.ts` 是前一节的超集（R8）。精确契约见 [EVOLUTION.md](./EVOLUTION.md)。

| 节 | 主题 | 给 mini Pi 加的零件 | Pi 边界 |
| --- | --- | --- | --- |
| [s01](./s01_minimal_agent_core/) | Agent Core | core + provider，存一轮消息 | provider 输入边界 |
| [s02](./s02_tool_contract/) | Tool Contract | 工具拆成 spec（给 provider）+ handler（留本地） | 工具契约边界 |
| [s03](./s03_provider_event_stream/) | Provider Event Stream | provider 从一次性返回升级为事件流 | provider 输出边界 |
| [s04](./s04_evented_tool_loop/) | Evented Tool Loop | tool_call → 执行 → 结果回写，带循环和终止保护 | 工具执行边界 |
| [s05](./s05_tool_hook_boundary/) | Tool Hook Boundary | 执行前后插口（before / after） | 工具插口边界 |
| [s06](./s06_turn_snapshot/) | Turn Snapshot | 一轮开始拍快照（systemPrompt/tools 固定；model 在 state） | 一轮状态边界 |
| [s07](./s07_session_tree/) | Session Tree | 历史从数组升级为可分叉的树 | 会话历史边界 |
| [s08](./s08_context_resources/) | Context Resources | 项目资料作为独立维度进入输入 | 上下文资源边界 |
| [s09](./s09_extension_runtime/) | Extension Runtime | 外部代码通过 API 注册 tool / command | 扩展 API 边界 |
| [s10](./s10_runtime_modes/) | Runtime Modes | core 产事件，外层 mode 决定展示 | 运行方式边界 |
| [s11](./s11_trust_and_execution_boundary/) | Trust and Execution | 加载看 trust、执行靠 containerization、细化拦截靠 hook | 执行权限边界 |
| [s12](./s12_package_distribution/) | Package Distribution | 能力整理成带清单的包分发 | 能力分发边界 |

---

## 如何阅读

按顺序 s01 → s12。每节：

1. 读「问题」和「解决方案」——理解**为什么**需要这个机制
2. 读「工作原理」——看机制怎么实现，末尾的点睛说清本质
3. 运行 `code.ts`，对照「试一下」的输出
4. 看「接入主线」——这节相对上节加了什么、焊在哪

每节只引入当前机制需要的术语；后续章节的术语会在对应章节第一次出现时再解释。

---

## 运行

```sh
npm install
npm run s01    # 从这里开始
npm run s02
# ...
npm run s12
```

所有章节用固定输入、fake provider 和内存数据，运行不依赖真实模型 API。

---

## 课程宪法

[EVOLUTION.md](./EVOLUTION.md) 是工程对照基准，每节的 `code.ts` 和 README 都对照它：

- **8 条元规则**：R1 字段只增、R2 方法只增、U1/U2 受控升级、R4 错误不崩、R5 循环终止、R6 加载/执行分离、R7 输出抽象、R8 累积
- **核心类型字典**：每个类型的稳定定义 + 引入节 + 演变
- **12 节累积主表**：每节加什么、保持什么不变
- **README 写作规范**：问题驱动 + 五条写作规则（含词汇纪律、去 AI 味）

---

## 和 Pi 的关系

`learn-pi-agent` 不逐行解释 Pi 源码。每节先写一个最小机制，再在折叠的「Pi 源码溯源」里说明它对应 Pi 的哪个设计位置。真实 Pi 更复杂，教学版只保留每个机制的最小主干——但机制之间的连接是齐全的，这就是上面那条 turn 执行链。
