# AgenticX 群聊机制与 Nexus、WorkBuddy 竞品对比

> 调研日期：2026-07-21  
> 调研范围：AgenticX 当前仓库、同级 Nexus 仓库、本机 WorkBuddy 5.2.6 安装包，以及 OpenAI Agents SDK、Claude Code Agent Teams、Microsoft AutoGen 官方资料。

## 一、结论摘要

AgenticX 当前群聊已经是“能真实调用不同分身执行任务的智能群聊”，但还不是成熟的多智能体协作运行时。

三套产品的定位差异很明确：

- **AgenticX**：自然、微信式、默认智能路由体验最好。
- **Nexus**：协作协议、状态隔离、持久化和执行可靠性最强。
- **WorkBuddy**：团队执行控制台和专家模板的产品化程度最高。

推荐方向不是照搬其中某一套，而是：

> 保留 AgenticX 的自然群聊体验，吸收 Nexus 的协作底座，再补齐 WorkBuddy 的任务面板和专家团模板。

## 二、AgenticX 当前群聊逻辑

### 2.1 主链路

用户消息进入群聊后，主要经过以下链路：

```text
用户消息
  ├─ 明确 @成员 → 直接唤醒对应分身
  ├─ @Machi → Meta-Agent 回答或协调
  ├─ 命中复杂任务启发式 → Workforce 拆解 → 成员执行 → Machi 汇总
  └─ 普通消息 → LLM 判断最合适成员
                    ├─ 成员回答
                    ├─ 无人适合时 Machi 兜底
                    └─ 回答中 @其他成员 → 继续唤醒，最多若干跳
```

核心实现位于 `agenticx/runtime/group_router.py` 的 `GroupChatRouter`。

### 2.2 路由规则

当前默认模式为 `intelligent`，路由优先级大致为：

1. 用户显式 `@` 的成员优先。
2. 用户显式点名 Machi 时，由 Meta-Agent 处理。
3. 多成员群聊中，命中复杂任务启发式时进入 Workforce 团队模式。
4. 普通消息由 LLM 根据成员角色、最近群聊上下文和活跃话题判断 `route_to`、`meta_direct` 或 `continue_thread`。
5. 被选成员可以输出 `__SKIP__` 表示不适合回答。
6. 如果成员未能有效回答，Machi 会先提示或兜底。
7. 成员最终回复中出现其他成员的 `@` 时，可以继续触发有限深度的接力。

配置层仍保留 `round-robin`、`user-directed`、`meta-routed`、`team` 等模式，但产品默认不要求用户显式选择编排策略。

### 2.3 执行模型

被选中的分身不是由 Machi 模拟发言，而是启动真正的 `AgentRuntime`：

- 使用分身自己的默认 Provider、Model、角色和 System Prompt；
- 可以使用 Studio 工具；
- 继承工作目录、上下文文件和 taskspaces；
- 保留 ConfirmGate 和 ClarifyGate；
- 工具调用和阻塞确认可通过群聊事件流反馈给前端。

因此当前方案属于“真实执行”，不是伪多角色生成。

### 2.4 Workforce 团队模式

复杂任务会进入 Workforce 桥接流程：

1. Task Planner 生成子任务。
2. Coordinator 将子任务分配给群成员。
3. 各成员通过完整 `AgentRuntime` 执行任务。
4. Machi 收集结果并生成最终总结。

该方向在架构上是正确的：用 Workforce 负责规划，用 AgentRuntime 保留工具、流式事件、确认门禁和既有运行时能力。

### 2.5 前端呈现

Desktop 群聊目前支持：

- 成员列表和固定的 Machi 元智能体；
- 输入框内 `@` 成员识别；
- 每成员 typing 状态；
- 工具进度和确认请求展示；
- 以成员身份展示最终回复；
- 通用会话停止；
- Workforce 生命周期事件展示。

部分成员进度已经聚合进状态卡，但 Workforce 的规划、分配、开始、完成事件仍有一部分作为独立 `[系统]` 消息进入聊天流，存在刷屏问题。

## 三、AgenticX 当前关键短板

### 3.1 成员不是持久化的独立群聊会话

每次唤醒成员时，系统都会创建新的 `StudioSession`，把工作区和上下文文件复制进去，再将最近公共群聊历史拼进提示词。

这意味着：

- 分身执行是真的；
- 但成员没有持续存在的独立群聊 session；
- 没有成员自己的私有 transcript；
- 没有 public/private cursor 和 checkpoint；
- 长任务和连续追问主要依赖最近公共消息恢复上下文。

这会限制长时协作、私下交接、断点恢复和精确的成员上下文控制。

### 3.2 Workforce 当前没有真正并行

设计文档描述了并行执行，但当前 `_run_team_turn` 对子任务使用顺序 `for` 循环。更准确的现状是：

> 自动拆解、自动分配、依次执行、最终汇总。

对于并行调研、前后端分工和竞争假设验证，当前速度及团队感明显弱于真正并发的团队运行时。

### 3.3 团队控制接口尚未完整接通

后端已经提供群聊团队事件流和 `pause`、`resume`、`stop`、`skip_task`、`add_task` 等动作接口，前端也会发送这些动作。

但当前代码中：

- `_group_team_event_buses` 只有声明和读取，未看到执行过程注册有效 event bus；
- `TaskLock` 的动作队列没有被群聊 Workforce 主循环消费；
- 因而 UI 发出动作不等于执行器已经应用动作。

通用请求断开仍可能停止整个生成，但任务级暂停、恢复、跳过和动态追加目前不能视为完整可用。

### 3.4 公共历史缺少事实边界

当前主要依靠统一的群聊 `chat_history` 构造上下文，没有像 Nexus 那样严格区分：

- 已完成的公共事实；
- 成员私有信息；
- thinking、tool use 等实时状态；
- 失败或取消的半成品；
- 成员之间的定向消息。

短对话问题不大，但在并发和长链路场景中容易产生上下文污染、重复消费或失败结果被误当成事实的问题。

## 四、与 Nexus 的对比

### 4.1 Nexus 的定位

Nexus Room 不是单纯的“群聊功能”，而是一套多智能体通信和调度协议。其协议明确只定义：

- 谁能看到什么；
- 谁在什么时机运行；
- 最终回复投递到哪里；
- 消息、唤醒、交接、队列和恢复如何保持一致。

具体业务流程则交由 Room Skill 定义。

核心设计文档：

- `/Users/dubianche/Code_repository/Nexus/docs/specs/room-collaboration-spec.md`
- `/Users/dubianche/Code_repository/Nexus/docs/specs/room-collaboration-mechanism.md`

### 4.2 Public 与 Private 分离

Nexus 明确区分：

- `public feed`：所有成员可见、已经完成并发布的事实；
- `private context`：只对指定 Agent 可见的定向信息；
- `wake`：是否以及何时让目标 Agent 获得一次执行机会；
- `reply route`：目标 Agent 的最终回复进入 public、private 或不发布。

stream、thinking、tool use、取消或失败的中间结果不会自动成为公共事实。

### 4.3 独立 Session、Cursor 与 Checkpoint

Nexus 为 Room 中每个 Agent 维护独立 runtime session，并分别记录：

- 公共消息消费 cursor；
- 私域消息消费 cursor；
- runtime checkpoint；
- 冷启动和恢复状态；
- 基于模型上下文窗口的消息预算。

这使成员可以从上次真实消费位置继续，而不是每轮重新拼接一段最近公共历史。

### 4.4 Handoff 与调度可靠性

Nexus 将 Agent handoff 作为一等协议：

- 普通显示 `@` 与真实 handoff intent 分离；
- handoff 使用 append-only ledger 持久化；
- 同一 source message 与 target 具备幂等约束；
- source 成功收口后才激活下游；
- source 失败或取消时传播取消；
- 有 cycle、visited、fanout、hop limit 等护栏；
- 目标忙碌时优先可靠 guide，否则进入持久化 queue；
- delayed wake 可以在进程重启后恢复。

### 4.5 Nexus 的代价

Nexus 的运行时可靠性更强，但复杂度也显著更高：

- 状态对象和持久化日志更多；
- 并发、重放、幂等和恢复逻辑更重；
- Room 平台不会默认替用户完成业务拆解和总结；
- 业务团队需要额外编写 Room Skill；
- 如果没有显式目标、单成员规则或 host default，消息可以只保存而不启动 Agent。

因此 Nexus 更像“协作操作系统”，AgenticX 更像“自带项目经理的智能群聊产品”。

### 4.6 对比表

| 维度 | AgenticX | Nexus |
|---|---|---|
| 产品定位 | 自带项目经理的智能群聊 | 多智能体协作协议和运行时 |
| 默认体验 | 不用配置即可聊天 | 更显式、更结构化 |
| 成员上下文 | 最近公共历史 + 临时 session | 独立 runtime session + public/private cursor |
| 任务拆解 | 内置 Workforce 自动拆解 | 平台不定义业务流程，由 Room Skill 定义 |
| 成员私聊 | 尚未形成一等模型 | directed message 是一等协议 |
| Handoff | 回复文本中的 `@` 触发 | 持久化 ledger、幂等、因果和循环保护 |
| 恢复能力 | 公共历史可恢复，成员执行态较弱 | pending wake、queue、cursor、handoff 可恢复 |
| 工程复杂度 | 较轻，迭代快 | 较重，但可靠性高 |

## 五、与本机 WorkBuddy 的对比

### 5.1 调研边界

`/Users/dubianche/Code_repository/workbuddy` 目录主要包含产物、脚本和记忆，不是 WorkBuddy 产品源码。

本节进一步读取了本机 `/Applications/WorkBuddy.app` 5.2.6 安装包中可见的 CLI 文档和内置 Skill，因此结论只覆盖本机可验证能力，不推断不可见的云端实现。

### 5.2 通用 Agent Teams

WorkBuddy 的通用 Agent Teams 具备：

- 一个固定 team lead；
- 每个 teammate 有独立上下文窗口；
- 共享任务列表，包含 pending、in-progress、completed 和依赖；
- 成员之间可以通过 mailbox 直接发消息；
- 用户可以聚焦任意成员，查看完整历史和执行进度；
- 可以直接向成员追加要求或打断；
- 支持 delegate mode，约束 lead 只协调、不直接执行；
- 支持执行前 plan approval；
- 支持真正的并行成员执行。

本机文档：

`/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/dist/web-ui/docs/cn/cli/agent-teams.md`

这套机制与 Claude Code Agent Teams 高度同构。两者都采用 lead、独立 teammate、共享任务列表、成员 mailbox 和集中管理，同时也有类似限制：

- 成员 session 无法完整恢复；
- 任务状态可能滞后；
- 关闭团队可能较慢；
- 一个 session 只能维护一个 team；
- 不支持 nested team；
- lead 固定，不能转移。

### 5.3 专家团产品层

WorkBuddy 还在通用团队机制之上提供“专家团”产品层：

- 可以将团队打包成可复用的专家产品；
- 有主理人、成员 Agent 定义和分阶段 SOP；
- 支持 Phase 级并行和串行；
- 强制真正创建成员，禁止主理人伪造专家输出；
- 专业结论必须由对应专家实际产出；
- 专家团默认采用主理人中转的 hub-and-spoke 模式。

本机规范：

`/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/resources/builtin-skills/expert-manager/references/team-spec.md`

这一层让 WorkBuddy 在投资专家团、研究团队、开发团队等“拿来即用”的垂直产品上，比 AgenticX 更成熟。

### 5.4 WorkBuddy 的优势与限制

相较 AgenticX，WorkBuddy 的优势是：

- 共享任务列表更成熟；
- 真并行执行更完整；
- 用户可以聚焦和直接干预单个成员；
- 任务依赖、计划审批、delegate mode 更清晰；
- 专家团模板和 SOP 更接近可销售产品。

其主要限制是：

- 通用 Agent Teams 的 session recovery 较弱；
- 固定 lead 和单 team 模型灵活性有限；
- 团队运行成本与 Token 消耗更高；
- 专家团严格的主理人中转模式不适合所有协作场景。

## 六、市面同类方案

### 6.1 OpenAI Agents SDK

OpenAI Agents SDK 主要提供两类多智能体模式：

- Manager 将其他 Agent 当作工具调用，并统一负责最终答案；
- Handoff 将当前对话控制权转交给专业 Agent。

此外可以通过代码实现串行链路、评审循环和并行执行。

官方资料：<https://openai.github.io/openai-agents-python/multi_agent/>

它更接近底层 SDK，而不是现成的终端用户群聊产品。

### 6.2 Claude Code Agent Teams

Claude Code Agent Teams 提供：

- team lead；
- 独立 teammate session；
- shared task list；
- 成员间直接通信；
- 用户直接查看和干预成员；
- in-process 和 split-pane 两种展示。

官方也明确将其标记为实验能力，并列出 session 恢复、任务状态同步和退出速度等限制。

官方资料：<https://code.claude.com/docs/en/agent-teams>

### 6.3 Microsoft AutoGen

AutoGen AgentChat 提供多种预置团队：

- `RoundRobinGroupChat`；
- `SelectorGroupChat`；
- `MagenticOneGroupChat`；
- `Swarm`。

AutoGen 更偏框架和研究型运行时。官方也提示，多 Agent 需要比单 Agent 更多的 scaffolding，简单任务不应为了团队形式而强行多 Agent 化。

官方资料：<https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/teams.html>

## 七、横向评分

评分基于当前代码、本机安装包和公开资料，表示工程成熟度判断，不是营销评分。

| 能力 | AgenticX | Nexus | WorkBuddy |
|---|---:|---:|---:|
| 自然群聊与隐式路由 | 5 | 3 | 3 |
| 独立成员上下文 | 2 | 5 | 4 |
| 真并行与共享任务板 | 2 | 4 | 5 |
| 私域通信与可靠交接 | 2 | 5 | 4 |
| 中断、干预、执行透明度 | 3 | 5 | 5 |
| 重启恢复与一致性 | 2 | 5 | 2–3 |
| 专家团队模板产品化 | 2 | 4 | 5 |
| 接入现有 AgenticX 工具生态 | 5 | 2 | 2 |

## 八、P0：优先补齐协作底座

### P0-1：实现真正受控的并行执行

- 将 Workforce 子任务从顺序循环改为受并发上限约束的并行调度。
- 只有无数据依赖的任务可以并行；存在依赖的任务按 DAG 解锁。
- 对成员、模型和工具调用设置并发上限。
- 对取消、超时、部分失败和重试定义明确语义。

### P0-2：接通团队控制链路

- 让 `pause`、`resume`、`stop`、`skip_task`、`add_task` 真正进入执行器。
- 每个动作返回 `applied`、`rejected` 或 `pending` ACK。
- 前端只有收到 applied ACK 后才更新最终状态。
- 增加请求断开、重复动作和无效 task id 测试。

### P0-3：建立成员独立 runtime session

- 每个 `group_id + conversation_id + avatar_id` 对应稳定 session。
- 独立保存成员 transcript、运行状态和 checkpoint。
- 连续追问回到同一成员上下文。
- 应用重启后可恢复最后一次有效 checkpoint。

### P0-4：增加最小任务 Ledger

至少记录：

- task id；
- root task id；
- assignee；
- pending、running、blocked、completed、failed、cancelled；
- dependencies；
- attempt；
- idempotency key；
- result reference；
- cancellation reason。

Ledger 应是任务状态真相源，SSE 只作为 UI 投影。

### P0-5：统一执行进度投影

- 每个成员每轮只显示一张可折叠进度卡。
- Workforce 规划、分配、工具、确认和完成事件进入同一张卡。
- 群聊消息流只保留用户消息、最终成员产出和必要的阻塞信号。
- 禁止把每个生命周期事件写成独立系统气泡。

### P0-6：补齐可靠性测试

覆盖：

- 多成员并行；
- 同一成员忙碌时的排队；
- 取消传播；
- SSE 断线；
- 应用重启；
- 重复事件和幂等；
- 成员失败后的部分结果处理；
- 长对话上下文边界。

## 九、P1：增强协作表达力与产品化

### P1-1：引入 Public/Private 上下文

- Public feed 只保存用户输入和已完成的公共事实。
- Private context 保存定向消息和成员私有结果。
- thinking、tool use 和失败半成品不进入公共事实。
- 为每个成员分别维护 public/private cursor。

### P1-2：将 Directed Message 做成一等协议

建议最小字段：

- recipients；
- wake_targets；
- wake_policy：none、immediate、delayed；
- reply_route：public、private、none；
- next_reply_route；
- correlation_id。

### P1-3：增强 Handoff 语义

- 普通显示 `@` 与真实 handoff intent 分离。
- handoff 持久化并具备幂等 ID。
- source 成功后才激活 target。
- 增加 visited、cycle、fanout 和 hop limit。
- 同一 source-target 不重复派发。

### P1-4：成员详情与直接干预

增加成员详情面板，展示：

- 当前任务和状态；
- 独立历史；
- 工具调用摘要；
- Token 和耗时；
- 阻塞原因；
- 直接追问、打断、重试和重新分配。

### P1-5：Group Skill 与专家团模板

将通用协作协议与业务流程分离，允许定义：

- 角色；
- 阶段；
- 并行或串行关系；
- 输入输出依赖；
- 汇总者；
- 终止条件；
- 质量门禁；
- 所需工具和模型。

优先提供研发团队、深度调研、内容生产、投研分析等模板。

### P1-6：恢复与断点续开

- 恢复成员 runtime session；
- 重放未完成 queue 和 delayed wake；
- 保留任务 ledger 和 handoff 状态；
- 恢复后避免重复发布已完成结果；
- 旧 checkpoint 无法证明有效时安全冷启动。

## 十、最终判断

AgenticX 当前的优势不在于拥有最多的编排模式，而在于它已经把多智能体协作包装成了普通用户可以理解的群聊体验。

下一阶段不应继续堆叠更多路由启发式，而应优先强化状态模型和执行可靠性：

> AgenticX 现在赢在“像群聊”，Nexus 赢在“像可靠的分布式协作系统”，WorkBuddy 赢在“像可操作、可售卖的 AI 团队产品”。最合理的演进路线，是用 Nexus 式底座支撑 AgenticX 的自然交互，再吸收 WorkBuddy 的任务控制台和专家团产品化能力。
