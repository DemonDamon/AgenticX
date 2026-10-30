# Data Suite P3+ Harden：通用能力硬化 Backlog（主仓）

Planned-with: glm-5.3
Suggested-Impl-Model: 见子任务表
Status: planning（backlog 提纲；各 H 开工前按 harden-6 粒度拆 executable sub-plan，拆完转 implementation-ready）

> 上游规划：`.cursor/plans/pending/2026-10-27-agx-data-suite.plan.md`（A1~A8 总纲）、`2026-10-28-agx-data-suite-after-a8-roadmap.plan.md`（Track 2）。
> 本版按 PR #167 评审意见重写：排序依据改为**平台可复用面与杠杆**；补齐主仓准入准则、非目标、已合入基线盘点与逐条增量。

## 主仓准入准则（硬规则，违反即不合入）

1. **只合通用积木**：通道插件、registry/可插拔策略、稳定 API/DSL、通用 admin CRUD 壳与持久化、平台安全语义（默认只读、授权可写、凭据托管）。
2. **禁止进 `agenticx/` 与 admin 通用壳**：客户 schema、行业字典内容、画像/标签业务包、现场网络拓扑细节、投标与售前文案。
3. **B 层归位**：项目配置一律走 `examples/data_suite/delivery_pack/`（或客户仓），引擎与通用壳不得引用任何 B 层实体。
4. **样例纪律**：主仓样例/测试数据只用脱敏假数据（FakeChannel、公开数据集），不得出现真实客户字段。
5. **复用优先**：扩展 `channels/registry`、`store/file_store`、admin API 既有模式，不新建平行机制。

## 非目标 / 不进主仓

| 内容 | 归属 |
|---|---|
| 画像项目字段字典、标签清单、指标口径等业务内容 | `delivery_pack/dictionary/`（B2 配置） |
| 客户分区/目录规范、网络拓扑等现场约定 | `delivery_pack/channels/`（B1 配置） |
| 售前「能力地图一页」等 GTM 文案 | Track 4 / docs GTM 或 delivery_pack 文档 |
| 认证方式的具体接入实例（某客户 IAM/IdP 对接） | `delivery_pack/iam/strategy.yaml`（B5 插件实例） |
| 业务看板内容（某行业 L1-L4 视图） | `delivery_pack/boards/`（B3 配置） |

## 已合入基线盘点（main @ 223946eb6，各 H 不得重做）

- **S2-6（#141）**：admin 字典/看板数据条目已可写（CRUD + `data_suite/store/file_store` 持久化），含 e2e（`enterprise/scripts/e2e-data-governance.ts`、`e2e-data-boards.ts`）。
- **S2-7（#142）**：A8 巡检 Agent 已挂 managed `PatrolScheduleConfig` + `HttpWebhookSink`（质量/口径巡检定时运行）。
- **P3 spine（#141）**：`examples/data_suite/golden-path/` 端到端（FakeChannel 主线）。
- **P4（#143）**：`delivery_pack/` B 层五件套（通道/字典/看板/ID/认证策略 YAML）。
- **A1 已有**：ClickHouse/JDBC/Kafka/Fake 通道 + grants + 凭据托管；**Hive 与文件通道为 Fake/未实现**。

## 优先级原则（平台杠杆，非项目排序）

`通道齐套（A1 验收达成）→ 治理/看板可运营（A4/A6 收口）→ 认证可插拔（A7 收口）→ 取数权限闭环 → 调度运维面 → LLM 差异化闭环`

> 外部动机（数据类项目投标可演示）属 Track 4 GTM，见附录脚注；不作为 H* 排序与 P 级依据。

## 子任务清单

| # | 任务 | 可复用面 | Suggested-Impl-Model | 优先级 |
|---|------|---------|----------------------|--------|
| H1 | 文件通道（SFTP/对象存储） | 五类通道齐套的 A1 最后一块 | gpt-5.6-sol-medium | P0 |
| H2 | Hive/Spark Thrift 通道 | 同上 | gpt-5.3-codex | P0 |
| H3 | 治理管理台收口（清洗/分级/质量流水线） | A4 可运营 | gpt-5.6-sol-medium | P0 |
| H4 | 认证路由全面 registry 化 | A7 可插拔收口 | gpt-5.6-sol-medium | P0 |
| H5 | 自助取数 ACL + 脱敏强制 | A6/A7 权限闭环 | gpt-5.6-sol-medium | P1 |
| H6 | DataFlow 调度运维面 | A2 可运营 | gpt-5.6-sol-medium | P1 |
| H7 | ID-Mapping 管理台 | A3 可运营 | gpt-5.3-codex | P1 |
| H8 | 圈选 DSL 真通道下推 | A5 引擎闭环 | gpt-5.3-codex | P1 |
| H10 | golden-path 通道场景扩展 | 演示/回归基座 | gpt-5.3-codex | P1 |
| H9 | NL2SQL LLM 闭环 + metering | A8 差异化闭环 | gpt-5.6-sol-medium | P2 |

**串行顺序：H1 → H2 → H3 → H4 → H5 → H6 → H7 → H8 → H10 → H9。**

### H1 文件通道（SFTP / 对象存储）

- **范围/落点**：`channels/file.py` + registry 注册：文件清单发现、批量下载/上传、断点续传、失败重试、凭据走既有 credentials binder、探查（schema 推断 + 样本预览）。
- **可复用面**：任意文件型数据交换场景的通用通道；补齐 A1「五类通道」原验收。
- **非目标**：不内置任何目录/分区规范；**路径与分区策略为可配置项**（path template policy，注入式），具体约定只出现在 golden-path 示例与 B 层配置。
- **增量 vs 已合入**：`channels/` 目前无 file 实现（仅 Fake）；全部为新增，复用 `channels/base.py` 协议、`grants`、`credentials`。
- **验收**：`tests/data_suite/test_channels_file.py`——清单发现/下载/上传/重试/授权写语义全绿；golden-path 增加文件通道变体。

### H2 Hive / Spark Thrift 通道

- **范围/落点**：`channels/hive.py`：HiveServer2/Spark Thrift 连接、默认只读 + grants 授权写、表/分区元数据探查；与 ClickHouse 通道同等级 e2e。
- **可复用面**：湖仓算力场景的通用连接器，对齐 A1 验收。
- **非目标**：不做任何现场拓扑假设；不做计算下推优化（后续另立）。
- **增量 vs 已合入**：`channels/` 无 hive；新增，复用 base 协议与探查接口。
- **验收**：`tests/data_suite/test_channels_hive.py` + golden-path Hive 变体（可用容器或 Fake Thrift 桩）。

### H3 治理管理台收口（清洗 / 分级 / 质量流水线）

- **范围/落点**：admin 治理域把**清洗规则、分级配置（默认 S/A/B/C 可配）、质量流水线、异常审核动作**从只读 fixture 升级为真 CRUD + 审核 action，落 `store/file_store`（复用 S2-6 模式）；质量日更任务真实运行。
- **增量 vs S2-6**：字典/看板条目 writable **已完成，不重做**；本项只补清洗/分级/质量流水线/审核四个实体与日更执行。
- **可复用面**：通用数据治理运营壳（规则模板化、审核队列），不绑定任何行业字典。
- **非目标**：字典内容、质量阈值等业务配置（B2）。
- **验收**：扩展 `e2e-data-governance.ts` 覆盖四实体 CRUD + 审核动作 + 日更运行一次。

### H4 认证路由全面 registry 化

- **范围/落点**：现有 OIDC/Keycloak SSO 路由全部改走 `AuthStrategyRegistry`；新增认证方式 = 注册一个 strategy 插件。
- **增量 vs 已合入**：registry 已存在（A7），本项只做路由切换收口 + 零回归证明。
- **非目标**：任何具体客户 IdP 适配实例（B5）。
- **验收**：`enterprise` 端到端登录流（registry 路径）通过；新增 Fake strategy 的测试证明插件化。

### H5 自助取数 ACL + 脱敏强制

- **范围/落点**：A6 自助取数 API 与 portal 入口强制经过数据权限校验 + `masking/policy`；越权/未脱敏路径 e2e 失败用例。
- **增量 vs 已合入**：masking 引擎与 boards 已有，本项打通「取数 → ACL → 脱敏」闭环。
- **非目标**：业务看板内容；角色/密级业务定义（B 层）。
- **验收**：越权取数 e2e 断言 403/脱敏后输出；`tests/data_suite/test_masking_bind.py` 扩展。

### H6 DataFlow 调度运维面

- **范围/落点**：DataFlow 作业绑定 managed `schedule/schedule_run`；admin 作业运维页：运行历史、重跑/补数、快照回放入口、失败告警（复用 A8 webhook sink）。
- **增量 vs S2-7**：S2-7 是**巡检 Agent** 的 patrol schedule，已完成、不重做；本项是**数据作业**的调度绑定与运维页，二者共享 managed schedule 底座。
- **非目标**：巡检 Agent 调度；作业 SLA/计费。
- **验收**：golden-path 作业按 schedule 真实运行一次，admin 可见历史并重跑成功。

### H7 ID-Mapping 管理台

- **范围/落点**：idmapping profile 配置页、冲突审阅队列（人工裁决合并）、快照对比视图；稳定 profile API。
- **可复用面**：通用 ID 积木——ID 类型体系完全可配，与任何标签/实体 schema 解耦；样例只用脱敏假数据。
- **非目标**：任何业务 ID 体系定义（B4）。
- **验收**：`tests/data_suite/test_idmapping_admin.py`：配置两种假 ID 类型完成关联合并 + 冲突裁决。

### H8 圈选 DSL 真通道下推

- **范围/落点**：audience DSL 编译目标从 Fake 扩展到 ClickHouse/JDBC（下推查询），结果集过 masking；DSL 语义保持稳定（向后兼容测试）。
- **可复用面**：通用圈选积木，编译器面向通道而非面向某标签 schema。
- **非目标**：标签字典内容、行业人群包。
- **验收**：`tests/data_suite/test_audience_pushdown.py` + 量级基准（假数据 1e5 行）。

### H9 NL2SQL LLM 闭环 + metering

- **范围/落点**：nl2sql 模板接 runtime `llms` 供应商层（write guards 只读白名单）；巡检 Agent 计量入 metering；MA schedules 管理 UI 入口。
- **增量 vs 已合入**：模板/调度已有，本项补 LLM 真实闭环与计量。
- **非目标**：自然语言取数的业务话术与行业问答包。
- **验收**：`tests/managed/` 新增——nl2sql 只读护栏测试（禁写语句拒答）+ metering 记录断言。

### H10 golden-path 通道场景扩展

- **范围/落点**：golden-path 增加文件通道、Hive 变体与 H6 作业运维演示步骤；保持一条 README 命令跑通。
- **非目标**：**售前能力地图一页移出本计划**（归 Track 4 GTM / delivery_pack 文档），不得作为主仓 P0 依据。
- **验收**：golden-path README 变体命令全绿，截图入 `docs/agx-data-suite/shots/`。

## Done-when（平台口径）

1. A1 原验收达成：五类通道齐套（ClickHouse/JDBC/Kafka/文件/Hive），全部遵守默认只读 + 授权可写 + 凭据托管。
2. 治理、看板、作业运维三个 admin 域可真实运营（真 CRUD + 持久化 + 运行历史），非 fixture。
3. 新增一种认证方式 = 注册一个 strategy 插件，核心路由零改动。
4. 取数链路默认经过 ACL + 脱敏，越权路径有失败用例守护。
5. B 层零回渗：`agenticx/` 与 admin 通用壳不引用任何 delivery_pack 实体。

## 附录：外部动机脚注（非排序依据）

本 backlog 的外部动机是让数据类项目（治理 / 画像 / CDP 售前）达到「投标可演示」状态——该口径属 Track 4 GTM 与 `delivery_pack/`，由售前侧自行组装；主仓只对上表平台 Done-when 负责。

## 关联文档

- 上游总纲：`2026-10-27-agx-data-suite.plan.md`；Track 2 出处：`2026-10-28-agx-data-suite-after-a8-roadmap.plan.md`
- 已合入基线：#141（P3 spine + S2-6）、#142（S2-7 A8 schedule）、#143（P4 B-pack）
