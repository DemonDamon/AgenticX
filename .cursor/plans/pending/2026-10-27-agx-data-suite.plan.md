# AGX Data Suite：数据智能通用底座能力规划

Planned-with: glm-5.3
Suggested-Impl-Model: 见子任务表
Status: implementation-ready（P0 可先行）

## 目标

为 AGX 补齐「企业数据智能」方向的通用底座能力，使 AGX 在面对数据治理 / 用户画像 / CDP 类项目时，只需**少量项目侧配置与适配**即可交付，而无需每个项目从零研发数据工程能力。

本规划源于一次真实售前项目的能力缺口评估（背景见 `docs/agx-data-suite/requirement-background.md`，已脱敏），结论：当前 AGX 六个数据类交付域中五个为 0~10% 硬缺口，唯一接近可交付的只有权限安全域（约 60%）。

## 规划原则：产品能力与项目定制解耦

```
交付逻辑 = 补齐 A（通用能力，进产品主干）→ + B（项目定制，配置 + 少量适配）→ 交付
```

- **凡是可以用「配置 / 字典 / 插件实例」表达的，一律不写进引擎**；引擎只认通用语义。
- 定制需求进入项目层之前，先回答一个问题：「能不能用 A 的配置表达？」——防止项目专属逻辑渗漏进产品主干，这是本规划成败的关键纪律。
- 示例：主题域与字段字典是配置，宽表生成器只认通用 YAML 语义；ID-Mapping 引擎只认「任意 ID 类型关联」，具体 ID 体系（手机号 / 会员号 / 业务实体号）是项目配置；客户统一认证是认证适配器框架上的一个插件实例。

## 通用能力组（A1~A8）

### A1 数据连接套件（Connectors v2）— P0

- 能力：ClickHouse、Hive/Spark Thrift、通用 JDBC、Kafka（批 + 流）、文件通道（SFTP/OSS）五类连接器；「默认只读、显式授权可写」安全语义；连接池；凭据托管（复用 `agenticx/data_sources/credential_store.py`）；通道探查（schema 探测、样本预览）。
- 落点：`agenticx/connectors/` 扩展；`data_sources/plugins/` 机制通用化。
- 验收：五类通道各完成一次探查式查询与一次授权写入作业。
- 价值：任何企业数据项目的入口能力，一次建设全项目复用。

### A2 数据作业编排（DataFlow）— P0

- 能力：五类作业节点（抽取 / 清洗 / 转换 / 加载 / 快照）+ 作业 DSL（YAML 声明式）+ T+1 调度 + 补数 / 重跑 / 快照回放 + 作业级运行日志与血缘记录。基于现有 `agenticx/flow/`（execution_plan）+ `agenticx/studio/automation_scheduler.py` + managed schedule。
- 落点：`agenticx/flow/` 扩展节点类型；新增 `agenticx/data_suite/` 作业 DSL。
- 验收：一条 YAML 声明的端到端作业（抽取→清洗→OneID→宽表→快照）能定时跑通并重放。
- 价值：AGX 从「Agent 编排」补上「数据作业编排」，runtime 成为双引擎。

### A3 ID-Mapping 引擎 — P0

- 能力：任意 ID 类型可配置关联图谱；合并策略（优先级、冲突处理、过渡字段）配置化；Mapping 快照与回放。
- 落点：`agenticx/data_suite/idmapping/`。
- 验收：配置两种 ID 类型（如手机号、业务实体号）完成关联合并，冲突样本处理正确，历史快照可回放。
- 价值：OneID / 客户主数据是所有 ToC 数据项目的通用刚需，与行业无关。

### A4 数据治理套件（Data Governance）— P1

- 能力：① 字段级元数据目录 / 数据字典（四要素：业务定义 / 计算逻辑 / 更新频率 / 责任人），扩展 `agenticx/data_sources/catalog.py`；② 清洗规则引擎（规则模板库 + 配置化 + 异常隔离待审 + 全量留痕）；③ 可信度分级仲裁框架（分级体系与仲裁优先级可配置，内置 S/A/B/C 默认实现）；④ 数据质量看板框架（质量指标可配）；⑤ 轻量血缘（作业依赖图 + SQL 解析，表级→字段级渐进）。
- 落点：`agenticx/data_suite/governance/` + `enterprise/apps/admin-console` 新增「数据治理」域（与现有 AI 安全治理并列）。
- 验收：字典 / 规则 / 分级全部经配置接入（无引擎改动），质量指标按日更新。
- 价值：admin-console 从「Agent 治理台」升级为「Agent + Data 双治理台」，是产品级跃迁；数据治理是数据类项目最大的共性交付块。

### A5 标签与人群圈选引擎（Tag & Audience）— P1

- 能力：标签元模型（分层 / 四要素 / Owner 裁决 / 同名不同义校验）+ 标签计算引擎（SQL / Python UDF + 调度更新 + 血缘自动登记）+ 圈选 DSL（标签 × 人群 × 行为组合 → 下推查询）。
- 落点：`agenticx/data_suite/tags/`、`audience/`。
- 验收：首期少量核心标签跑通「定义→计算→圈选」链路，后续标签滚动扩展零引擎改动。
- 价值：CDP 核心能力；「先窄后宽」的落地节奏（首期小集合跑通，再滚动扩展）内置为产品推荐实践。

### A6 BI 看板框架（Dashboard Framework）— P1

- 能力：可配置图表框架（图元库 + 布局引擎 + 数据集绑定）+ 维度下钻 / 对比分析组件 + 自助取数与数据服务 API（带权限与脱敏联动）。
- 落点：`enterprise/apps/web-portal/` 新增 dashboard 模块（产品化，非一次性报表）。
- 验收：一个业务看板完全通过配置产出（无前端代码），支持逐层下钻与对比视图。
- 价值：所有项目的「呈现层」，一次建设全项目复用。

### A7 安全增强 — P2

- 能力：字段级脱敏规则引擎（按密级 / 角色的策略化，落到查询层与看板层）+ web-portal 全局页面水印组件 + 认证适配器插件框架（把现有 `api/auth/sso/oidc` 重构为 strategy 可插拔：OIDC / Keycloak / 客户 IAM 各为一个插件）。
- 落点：`agenticx/data_suite/masking/`；web-portal 全局组件；`enterprise/apps/admin-console/src/app/api/auth/sso/` 重构。
- 验收：新增一种认证方式只需实现一个 strategy 插件；脱敏 / 水印在查询与看板链路生效。
- 价值：等保 / 分级分类要求是政企项目标配；认证适配器框架终结「每接一个客户重写一遍 SSO」的重复劳动。

### A8 Data Agent 模板（Managed Agent 增值层）— P2

- 能力：基于 Managed Agent 体系（schedule / schedule_run + webhook + write guards + metering）沉淀三类可复用 Agent 模板：① 数据质量巡检 Agent（定时巡检 → 质量事件 webhook 通知）；② 口径巡检 Agent（字典口径 vs 实际数据漂移检测 → 治理待办）；③ NL2SQL 问答 Agent（自然语言取数 / 圈选问答，write guards 保证只读）。
- 落点：`agenticx/managed/` 模板化 + `examples/managed/` 样例。
- 验收：模板接入任意项目的字典与看板即可实例化。
- 价值：「会说话的数据资产」——数据治理自动化的差异化能力。

## 项目定制层（B 类，不进主干）

| 项 | 形态 | 说明 |
|---|------|------|
| B1 业务系统通道配置与接口适配 | 配置 + 适配脚本 | 基于 A1 五类通道逐系统配置；个别私有接口写适配器 |
| B2 域模型与字典 | 纯配置 | 主题域定义、字段字典、指标口径、标签定义、分级仲裁规则、质量阈值——YAML / 管理台录入 |
| B3 业务看板视图 | 配置 + 少量页面 | 基于 A6 框架配置视图；特殊页面少量前端开发 |
| B4 ID 映射策略 | 纯配置 | ID 类型、过渡字段、合并优先级——A3 引擎配置 |
| B5 认证适配器实例 | 插件实例 | 基于 A7 框架的 strategy 插件 |
| B6 部署与实施 | 工程实施 | 客户云部署、数据源联调、合规加固、培训、验收 |

原则：定制代码收在 `customers/` 变体目录，保持主仓主干零项目专属逻辑。

## 实施顺序与里程碑

| 阶段 | 范围 | 投入 | 里程碑意义 |
|---|---|---|---|
| P0 | A1 + A2 + A3 | ~10 人月 | 数据项目开工前置条件（硬闸门） |
| P1 | A4 + A5 + A6 | ~10 人月 | 与项目交付并行，边交付边沉淀 |
| P2 | A7 + A8 | ~4~5 人月 | 合规验收 + 投标差异化 |

沉淀完成后，同类项目交付侧只需约 15 人月（以配置与适配为主），对比不沉淀时每个项目从零研发（约 45 人月）——**第二个数据类项目起，交付成本下降约 2/3**。

## 已确认规划决策

- 算力层留在客户侧：A1 只做「接入与作业下发」，计算下推客户平台，数据不出域；不自建大数据平台。
- 双 runtime 定位：AGX 同时具备「Agent 编排」与「数据作业编排」，二者共用凭据、调度、观测与治理面。
- 通用能力的工程落点统一收敛在新包 `agenticx/data_suite/`（A2~A5），企业侧统一收敛在 web-portal dashboard 模块与 admin-console 数据治理域（A4/A6）。
- B 层纪律：B 类内容不进主仓主干；customers/ 变体目录承载项目专属代码。

## 风险与纪律

1. **A/B 边界纪律**是本规划成败关键：定制需求先问「能不能用 A 的配置表达」。
2. 凭据与安全：连接器默认只读，写权限显式授权并全量审计；凭据走 credential_store，禁止明文落库。
3. P0 是硬闸门：未完成前数据类项目一阶段不可开工。
4. 脱敏 / 水印若为项目一期验收项，A7 需从 P2 前移。

## P0 状态

- P0（A1–A3）已合入 `main`：PR #137 / `ff2ba8d0`。

## P1 执行拆分

按序执行，勿并行开多条产品线：

1. [P1 Index](./2026-10-28-agx-data-suite-p1-index.plan.md)
2. [P1-A4-1 Dictionary](./2026-10-28-agx-data-suite-p1-a4-1-dictionary.plan.md)
3. [P1-A4-2 Cleaning](./2026-10-28-agx-data-suite-p1-a4-2-cleaning.plan.md)
4. [P1-A4-3 Trust](./2026-10-28-agx-data-suite-p1-a4-3-trust.plan.md)
5. [P1-A4-4 Quality](./2026-10-28-agx-data-suite-p1-a4-4-quality.plan.md)
6. [P1-A4-5 Lineage + Admin stub](./2026-10-28-agx-data-suite-p1-a4-5-lineage-admin.plan.md)

A5 / A6 子计划在 A4 Done 后再开。

## P0 执行拆分（已落地）

按序执行，勿并行开多条产品线：

1. [P0 Index](./2026-10-27-agx-data-suite-p0-index.plan.md)
2. [P0-A1 Channels](./2026-10-27-agx-data-suite-p0-a1-channels.plan.md)
3. [P0-A2 DataFlow](./2026-10-27-agx-data-suite-p0-a2-dataflow.plan.md)
4. [P0-A3 ID-Mapping](./2026-10-27-agx-data-suite-p0-a3-idmapping.plan.md)

同步副本：`docs/superpowers/plans/2026-10-27-agx-data-suite-p0-*.md`

## 关联文档

- 需求背景（脱敏）：`docs/agx-data-suite/requirement-background.md`
- 目标架构图：`docs/agx-data-suite/agx-data-suite-architecture.svg`

## P1 状态

- P1（A4–A6）已合入 `main`：PR #138 / #139。

## P2 执行拆分

可执行子计划（顺序执行）：

1. [P2 Index](./2026-10-28-agx-data-suite-p2-index.plan.md)
2. [P2-A7 Index](./2026-10-28-agx-data-suite-p2-a7-index.plan.md)
3. A7-1 … A7-5 under `.cursor/plans/pending/2026-10-28-agx-data-suite-p2-a7-*.plan.md`

A8 子计划在 A7 Done 后再开。

