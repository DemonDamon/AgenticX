# DeepSeek Harness 最新增量复核与 Near 差异化战略

> 复核日期：2026-09-08  
> DSH checkout：`c389f96bf3a9b6807cb71ed6bdad5849be0df6d8`  
> 最近版本标识：`dsh-v0.1.3-alpha.2-133-gc389f96bf3`  
> 研究性质：静态源码与测试证据复核，不改 AgenticX 产品代码

## 一、结论先行

推文抓住了 DSH 的主线，但对最新版有一处关键低估：

1. **DSH 的架构核心确实不是 Coding Agent UI，而是可寻址、可组合、可撤销的 Harness 运行时。** 但 “Meta-Harness” 不是上游正式子系统名，且 headless/sdk/acp 等 profile 并不都支持运行时换树。
2. **Cordis 确实把“组件替换”从全局重写降为局部生命周期事务**，但这只覆盖通过 Cordis API 注册和托管的副作用；插件绕过框架直接制造的全局副作用并不会被魔法清理。
3. **最新版已经不只是“会热重载”**：动态 Cordis 插件具备不可变 Package、显式 define/run/update/stop、失败保留旧 current、人工审批、诊断与 rollback 语义；大量包还新增了可归因的运行时 invariant。需要注意，这套动态 Package 当前是进程内状态，并非持久化的自进化资产库。
4. **DSH 仍没有完成真正的自进化闭环**：它能安全地产生、激活和回退变体，也能诊断运行时约定是否被破坏，但没有根据真实任务效果做个性化 Held-out Eval、反事实对照、自动晋级和长期漂移治理。
5. **Near 不应与 DSH 正面竞争“谁的 Harness 更可插拔”**。最有机会形成壁垒的定位是：

> **DSH 是 Agent 可修改自己的 Harness OS；Near 应成为能持续理解用户、治理专家团队、验证每次进化是否更贴近用户的 Personal Agent Control Plane。**

一句话说，DSH 的强项是“安全地改变机器”，Near 应抢占“知道为什么改、替谁改、改完是否更像这个用户”。

## 二、五个观点逐条复核

### 观点 1：DSH 是可热重载的 Meta-Harness

**判定：部分确认。**

证据：

- `upstream/docs/architecture.md` 明确把模型适配、工具注册、Session Log、Agent Loop 都定义为插件。
- `upstream/vendor/cordis/src/context.ts` 提供 `isolate`、`extend`、`intercept`、service 与 plugin 生命周期能力。
- `upstream/docs/user/develop/framework/index.md` 描述 Fiber 状态机、依赖驱动加载、自动清理、嵌套 Context、dispose 与 HMR。
- `upstream/packages/preset/agent-presets/` 把 agent 形态建模为可组合 preset，而非写死的产品模式。

边界：

- “Meta-Harness”是合理的架构概括，不是仓库里的正式命名子系统。
- `patchReload: live`、Cordis HMR 与 Creator 路径支持运行时变化，但 headless、sdk、sdk-minimal、acp 等 profile 主要在启动时一次性应用 patch，不能概括为所有形态都能运行时换树。
- UI 与 Coding Agent 仍是重要产品面，只是不是最难复制的内核。

### 观点 2：Cordis 用时空可组合性控制插件熵增

**判定：确认，但要收窄“自动清理一切”的表述。**

证据：

- Cordis Fiber 持有插件生命周期，并在 dispose 时释放框架托管的 effect、listener、service 与子 Fiber。
- `inject` 让插件声明依赖服务；依赖缺失时 Fiber 可等待，依赖恢复后重新激活。
- DSH 的注册表测试普遍要求 HMR-safe：释放贡献 Fiber 后，注册内容必须消失。
- 最新 `dsh-invariants` 将每个包拥有的事件流与可变快照关系放回包自己的 companion 检查，并把违规归因到具体 package。

边界：

- Cordis 只能可靠撤销通过 `ctx.effect`、`ctx.on`、service/plugin API 等纳入生命周期管理的副作用。
- 如果插件直接改全局单例、直接创建未登记 timer 或进程，框架无法自动保证可逆。
- 因此更准确的说法是“Cordis 提供可逆副作用协议和机械门禁”，不是“任意 JavaScript 副作用天然事务化”。

### 观点 3：优化此刻最优 vs 优化持续可变性

**判定：作为战略解释成立，但不是可由代码单独证明的事实。**

源码能证明 DSH 大量投入在：

- 插件级依赖与生命周期；
- composition/preset 可替换；
- HMR 安全；
- immutable package 与 current/next 指针；
- runtime inspect 与 invariant；
- session generation、持久化与跨进程写入所有权。

这些选择确实优先保证“持续可变而不撕裂”。但对其他产品路线的判断属于文章作者的战略归纳，不应伪装成 DSH 源码事实。

### 观点 4：短期用户是开发者，长期用户是 Agent 自己

**判定：前半段强确认，后半段是合理愿景而非已完成能力。**

证据：

- `upstream/packages/preset/agent-presets/presets/cordis/agent.cordis.yml` 明确告诉 agent：“You can read and modify the harness you run on.”
- `editing-cordis-compositions/SKILL.md` 教 agent 区分 host composition 与 session preset，并从 shipped preset 复制为用户可编辑 preset。
- `tool-cordis/src/index.ts` 暴露：
  - `cordis_inspect_list/query/self`
  - `cordis_define`
  - `cordis_run`
  - `cordis_stop`
  - 后续版本与删除能力
- `cordis_define` 只创建不可变 Package，不执行代码；`cordis_run` 才激活，并在未授权 Client Package 上进入用户审批。

尚未被证实的部分：

- `cordis_*` 动态 Package 当前不持久化，进程重启后不会自然成为长期资产。
- preset 的结构化 authoring API 主要提供整目录 copy；后续 composition 修改仍依赖文件工具编辑用户目录 YAML，并非完整的“Agent 直写 preset API”。
- 没有看到把 Creator/Cordis 轨迹自动加工为训练集并训练下一代策略的完整流水线。
- 没有看到 agent 自主从长期任务失败中选择 Harness 组件、生成多个候选并依据行为 Eval 自动晋级的产品闭环。

### 观点 5：热重载不等于自我改进

**判定：核心判断完全正确，但“DSH 缺诊断和回滚”已部分过时。**

最新版已具备：

- 动态插件 immutable Package 历史；
- current/next Package 指针；
- update 失败时保留旧 current；
- rollback/restart 语义；
- Host/Client 双端运行状态与 missing services 诊断；
- package-owned runtime invariants；
- 单测、100% 文件覆盖门禁、真实 API e2e、snapshot、Web 浏览器快照、性能 benchmark 等工程回归体系。

最新版仍缺：

- 从用户任务历史自动提取 failure mode；
- 将 failure mode 归因到 memory/tool/prompt/loop/avatar/policy 某一可变组件；
- 为特定用户生成 held-out task set；
- 候选版本的 shadow replay / A-B 对照；
- 质量、成本、延迟、安全、用户风格一致性的联合评分；
- 满足门槛后的自动 canary、晋级、观察与回滚；
- 跨时间的用户偏好漂移与灾难性遗忘评估。

所以 DSH 已从“船坞”进化到“带版本控制、仪表盘和结构自检的船坞”，但仍没有为每位用户提供“导航目标与试航裁判”。

## 三、最新版 DSH 最值得重视的增量

### 1. 动态 Cordis 插件成为真正的变更事务

`packages/extensions/tool-cordis/src/index.ts` 的关键语义：

- `cordis_define`：追加不可变 Package，不执行、不切 current。
- `cordis_run(mode=run|update)`：激活指定 Package。
- update 只有完整成功后才更新 current；失败保留原 current。
- Client 半边可触发用户审批。
- `cordis_inspect_self` 能查看插件、Package、source、Run 与 diagnostics。
- stop 不删除版本和授权，可再次运行或回滚。

这已经非常接近“Agent 自改组件的事务日志”，Near 值得借鉴其 **define 与 activate 分离、不可变版本、current/next 双指针**。

但它是会话/进程内的动态运行时版本管理，不应误写成已经持久化的长期 Learning Store。

### 2. Runtime Invariants 把故障归因下沉到组件所有者

`packages/runtime-diagnostics/invariants/README.md` 显示：

- invariant 由各 package 的 companion 提供；
- 检查的是该包拥有的真实事件流/可变状态关系；
- 失败携带稳定错误码与 packageName；
- companion 安装失败会回滚注册，不残留监听器；
- Session、Agent、Scope、Loop、LLM、Tools、Prompt、Compaction、Hooks、Sandbox、Subagent、Workflow、Goal、Approval、Settings、Workspace、Preset、HMR 等已有覆盖。

这不是“任务做得好不好”的 Eval，却是很强的 **结构故障定位底座**。

### 3. Agent Preset 已从配置文件进化为 generation-aware composition

`agent-presets` 的最新服务契约包含：

- standing mount；
- 新 Session 加入当前最新 generation；
- child agent 继承 parent 正在运行的同一 generation，而不是重新读文件；
- composition inventory 以 live mount 为准；
- recompose 先确保新 composition 可用，再移动绑定；
- 为避免历史工具调用与新工具集不一致，已有消息的会话不应中途随意换 preset。

这比“加载一份 YAML”严谨得多，核心是在维护 **会话历史与能力版本的一致性**。

### 4. Session 持久化已成为并发与恢复基础设施

最新代码包含：

- JSONL durable generation；
- migration 与压缩；
- cross-process write ownership lease；
- session projection/query 与 SQLite；
- parent/child generation 快照；
- cancelled/partial stream 等持久化语义。

它使运行时变异、子智能体、恢复和回放有可信日志基础。

### 5. Inspector 与浏览器/Host 双运行时可观测性增强

`packages/experimental/inspector/` 已有 CDP Runtime/Debugger、Host/Client realm、Cordis tree/model 与浏览器 e2e。虽然仍在 experimental，但方向明确：DSH 正把“自改 Harness”需要的可观察对象模型补齐。

## 四、Near 当前真正拥有的牌

### 1. 真分身委派，而不是临时子任务冒充身份

`agenticx/runtime/meta_tools.py::_find_or_create_avatar_session` 会复用或创建绑定 `avatar_id` 的真实 Session；`_run_delegation_in_avatar_session`：

- 使用分身自己的 provider/model、persona、workspace；
- 继承主会话 taskspaces、context_files 与 sandbox policy；
- 在分身自己的 `messages.json` 中留下过程与结果；
- 记录 delegation run、活动、工具、确认与输出文件；
- 分身还能继续创建其自己的临时子智能体。

这让 Near 具备“长期数字专家组织”，不是一次性 subagent pool。

### 2. Meta-Agent 已具备组织视野和调度工具

`agenticx/runtime/prompts/meta_agent.py` 会注入：

- 已注册 Avatars；
- 活跃子智能体状态；
- memory recall；
- session summary；
- taskspaces、skills、MCP 与上下文文件。

`agenticx/runtime/meta_tools.py` 提供：

- `delegate_to_avatar`
- `chat_with_avatar`
- `read_avatar_workspace`
- `create_avatar`
- `update_self_identity`
- `create_group_chat`
- `query_subagent_status`

这已经比单 Session 自改 Harness 更接近“组织级 Meta-Agent”。

### 3. Near 已有技能进化雏形

现有链路包括：

- Tool call observation 与成功推断；
- session analyzer；
- session review hook；
- GEPA 风格 N-candidate proposal；
- skill quality gate；
- pending approve/reject queue；
- skill version snapshot、history 与 rollback；
- 低效技能 deprecation；
- 基于条件的 skill visibility。

Near 并非从零开始做 Learning Loop。

### 4. Near 的天然优势是跨场景行动面

AgenticX 已覆盖 Desktop、工作区、MCP、Computer Use、知识库、IM、定时任务、语音/设备规划等方向。DSH 的主战场仍是开发者与 Coding Harness。只要身份、权限、记忆与评估能跨渠道保持一致，Near 的产品空间明显更大。

## 五、必须直面的四个架构缺口

### 缺口 1：Meta “能搜索所有对话”不等于“持续看见并理解所有专家”

Near 有全局 `session_search`/FTS，但目前更像按关键词拉取历史：

- Meta prompt 不会自动注入所有分身的新对话摘要；
- 缺少统一的跨分身事件账本、因果链与未读变化游标；
- 缺少“这条用户偏好由哪个会话、哪次纠正、哪位专家观察到”的 provenance。

此外，`session_search` 属于 `STUDIO_TOOLS`，普通分身也能获得；当前“Meta 权限最高、分身只看授权范围”更多是产品叙事，不是完整的强制权限层级。

#### 子智能体状态还不是单一可信控制面

`query_subagent_status` 需要在 session TeamManager、全局 registry、scratchpad、chat history 与 avatar session 信息之间做 fallback；代码还会检测 `session._team_manager` 与当前 manager 不一致。这说明：

- 委派轨迹和 activity 已真实落盘；
- 但 Meta 看到的运行状态仍可能来自多个投影；
- “团队当前在做什么”还不是单一 source of truth。

两周 MVP 应优先以 `SubAgentRunStore` / 统一 run ledger 为权威源，其他状态只作为兼容迁移输入。

### 缺口 2：用户画像仍是提示词字段，不是可治理的 User Constitution

当前 `user_nickname` / `user_preference` 主要作为文本块注入系统提示。它缺少：

- 偏好类型与适用域；
- 来源、证据、置信度；
- 显式指令 vs 推断偏好；
- 冲突解决；
- 生效范围；
- 版本与撤销；
- 敏感性与可共享范围；
- 时间衰减和漂移。

“Meta-Agent 就是用户分身”若没有结构化宪法，很容易退化成“一个积累了很多记忆的高权限助手”。

### 缺口 3：当前技能评分不能证明真实行为变好

现有 quality gate 能筛掉格式差、缺步骤、危险或不可执行的 Skill，GEPA/Pareto 也能管理候选；但主要还是 **文档候选质量**。

关键问题：

- benchmark 命中更接近文本覆盖，不是实际运行成功率；
- 没有把同一批任务分别交给 baseline 与 candidate 执行；
- 没有隔离副作用的 replay sandbox；
- 没有盲评用户风格一致性；
- 没有成本、延迟、安全回归联合门槛。

因此当前是“能提出并版本化技能”，还不是“能证明技能让这个用户的 Agent 变得更好”。

同时，LLM 会话复盘默认关闭，`skill_manage` 也需要显式启用；仓库已有 `evaluation/` 基础库，但尚未接入 Meta 日常运行路径。不能把“代码存在”直接等价为“默认产品闭环已运行”。

### 缺口 4：最高权限尚未被建模成受托治理

真正代表用户的 Meta-Agent 不应该只是拥有最多工具。它需要：

- 明确的 capability lattice；
- Meta-only、avatar-scoped、session-scoped、channel-scoped 权限；
- 用户可定义的不可变红线；
- 高风险动作双重门禁；
- delegation token 与最小授权；
- 所有越权读取和跨主体记忆共享的审计记录；
- “用户可追问为什么它代表我这么做”的解释链。

否则“最高权限”会成为安全负债，而不是产品优势。

## 六、Near 超越 DSH 的五个优先方向

### P0-1：Personal Eval OS

这是最重要、也最能直接击中 DSH 空缺的能力。

为每位用户建立私有评测集：

- 从真实任务、重试、纠正、拒绝、手工接管中抽取案例；
- 区分 train evidence、validation 与 held-out；
- baseline/candidate 做隔离 replay；
- 同时评估任务成功、用户风格、权限合规、成本、延迟；
- 支持 LLM judge，但必须混入确定性断言与用户最终选择；
- 只有通过回归门槛才能 canary；
- canary 失败自动回滚。

产品表达：

> “Near 不是会自我修改，而是每次修改前都能证明：它对你更好。”

### P0-2：User Constitution + Preference Graph

把“用户偏好”升级为可检查、可追溯、可撤销的用户宪法：

- `UserDirective`：用户明确声明，优先级最高；
- `InferredPreference`：从行为推断，带置信度与证据；
- `Boundary`：绝不能做、必须确认、允许自动做；
- `StyleProfile`：表达、交互、节奏偏好；
- `RelationshipPolicy`：哪些信息可给哪些分身/渠道；
- `Goal/Value`：长期目标和取舍权重；
- `Version/Conflict`：变更历史与冲突裁决。

所有分身不是复制用户画像，而是从同一宪法编译出不同 role view。

### P0-3：Meta-only Observation Ledger

建立 append-only 的跨主体观察账本：

- 每个 Session、Avatar、Subagent、IM、Automation 产生标准事件；
- Meta 按游标消费增量，不把所有原始对话塞进 prompt；
- 事件包含 actor、subject、source session、tool/action、outcome、evidence、sensitivity；
- Meta 生成可回溯摘要和 preference proposal；
- 普通分身默认只能看到自身与显式共享事件；
- 跨分身读取必须通过 capability token 和审计。

这才会把“Meta 能看到所有专家”从 FTS 搜索能力提升为持续组织学习能力。

第一阶段应直接复用现有 `SubAgentRunStore` 的 activity/artifact 记录，把它提升为统一 delegation control plane；不要再新增平行状态源。

### P1-4：Avatar Portfolio Evolution

DSH 优化组件；Near 可以优化“数字专家组织”：

- 发现职责重叠，建议 merge；
- 发现一个分身长期在两类任务上表现分裂，建议 split；
- 按领域、用户满意度、成本与延迟形成绩效画像；
- 自动推荐工具、技能、模型和记忆视图；
- candidate avatar 先 shadow 工作；
- 通过 Personal Eval 后才替换主力；
- 保留 lineage，可回退到任一代。

这会形成独特概念：**不是一个 Agent 自我进化，而是一支属于用户的数字专家团队持续进化。**

### P1-5：Reversible Capability ChangeSet

不必重写 AgenticX 为 Cordis，但应借鉴其事务语义：

- change set 明确目标组件：prompt/skill/tool/policy/model/memory/avatar/team；
- proposal 与 activation 分离；
- 所有候选不可变版本化；
- 记录 before/after、动机、证据与评测；
- shadow/canary 后更新 current 指针；
- 失败保留旧 current；
- 依赖和副作用清单可检查；
- 支持一键 rollback。

Near 的变更事务应是跨组件的，例如一次“财务专家升级”可以同时包含 Skill、模型、权限、记忆视图和评测集，而不是只换一段 prompt。

## 七、建议的 90 天路线

### 第 1 阶段：两周内证明方向

1. 以统一 run ledger 收敛 TeamManager 多实例与状态 fallback，让委派状态、activity、artifact 有单一可信源。
2. 对工具与 Session 查询加 Meta-only / avatar-scoped 强制边界。
3. 建最小 Observation Ledger，先接入 avatar delegation、用户纠正、工具结果。
4. 从历史中人工选 20–50 个代表性任务，建立第一版 Personal Eval。
5. 用同一 Skill 的 baseline/candidate 做离线 replay，并产出可解释对比。
6. UI 同时外露委派证据链与现有 `loop_review` 健康度，并展示“为什么建议升级、证据来自哪里、如何回滚”。

验收重点：不是候选能生成，而是同一任务集上能给出可重复的 baseline/candidate 差异。

### 第 2 阶段：3–6 周形成闭环

1. User Constitution v1：显式指令、推断偏好、边界、证据、版本。
2. ChangeSet v1：Skill + Prompt + Tool Policy 的统一不可变版本。
3. Shadow runner：隔离副作用、回放历史任务。
4. 多目标门槛：成功率、风格、权限、成本、延迟。
5. canary 与自动回滚。

### 第 3 阶段：7–12 周建立产品壁垒

1. Avatar merge/split/retire/recommend。
2. 专家 lineage 与绩效面板。
3. 跨 Desktop/IM/Automation/Voice 的同一 User Constitution。
4. 用户可视化的“我的数字团队如何理解我、最近学到了什么、哪些建议待批准”。
5. 将匿名、脱敏的通用改进与用户私有对齐层严格分离。

## 八、最后判断

如果 Near 只是继续增加 Meta-Agent 工具数量、允许创建更多分身、让它搜索更多历史，它不会自然超过 DSH；这只会得到一个更复杂、权限更大的 Agent。

Near 真正应该建立的是三个闭环：

1. **用户对齐闭环**：观察用户纠正，形成可追溯宪法。
2. **组织进化闭环**：组合、分化、淘汰、升级数字专家。
3. **证据晋级闭环**：任何 Skill/Prompt/Tool/Avatar 变化先评测、再灰度、可回滚。

DSH 已经把“可变性”做成工程纪律。Near 要赢，不能只比它更会变，而要比它更清楚：

- 为谁而变；
- 根据什么证据变；
- 哪个专家应该变；
- 变完是否真的更符合这个用户；
- 用户如何理解、否决和撤销这次变化。

这才是“Meta-Agent 是用户数字分身”从口号变成系统能力的分水岭。

## 九、核心证据索引

### DSH

- `upstream/docs/architecture.md`
- `upstream/docs/user/develop/framework/index.md`
- `upstream/vendor/cordis/src/context.ts`
- `upstream/packages/extensions/tool-cordis/src/index.ts`
- `upstream/packages/extensions/tool-cordis/src/api-catalog.ts`
- `upstream/packages/extensions/cordis-host-runner/src/index.ts`
- `upstream/packages/extensions/cordis-client-runner/src/client/runtime.ts`
- `upstream/packages/runtime-diagnostics/invariants/README.md`
- `upstream/packages/preset/agent-presets/src/index.ts`
- `upstream/packages/preset/agent-presets/src/authoring.ts`
- `upstream/packages/preset/agent-presets/presets/cordis/agent.cordis.yml`
- `upstream/packages/preset/agent-presets/presets/cordis/skills/editing-cordis-compositions/SKILL.md`
- `upstream/packages/session/session-persistence-jsonl/`
- `upstream/packages/experimental/inspector/`
- `upstream/docs/testing.md`

### Near / AgenticX

- `agenticx/runtime/prompts/meta_agent.py`
- `agenticx/runtime/meta_tools.py`
- `agenticx/runtime/team_manager.py`
- `agenticx/avatar/registry.py`
- `agenticx/learning/analyzer.py`
- `agenticx/learning/session_review_hook.py`
- `agenticx/learning/gepa_proposer.py`
- `agenticx/learning/drift_detector.py`
- `agenticx/learning/skill_quality_gate.py`
- `agenticx/skills/pending_queue.py`
- `agenticx/skills/skill_versions.py`
- `agenticx/cli/agent_tools.py`
- `agenticx/memory/session_store.py`
