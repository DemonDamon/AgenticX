# Data Suite P3+ Harden：面向真实数据项目交付的通用能力硬化

Planned-with: glm-5.3
Suggested-Impl-Model: 见子任务表
Status: implementation-ready

> 上游规划：`.cursor/plans/pending/2026-10-27-agx-data-suite.plan.md`（A1~A8 总纲）、
> `2026-10-28-agx-data-suite-after-a8-roadmap.plan.md`（Track 2 硬化轨道）。
> 本计划把 Track 2 落成可开工的子任务清单，并按「真实数据项目交付缺口」重排优先级：
> 一批即将启动的数据治理 / 画像类售前项目要求通道（文件 / Hive）、可运营的管理台、
> 调度运维面与取数权限闭环 —— 这些是当前从「能 demo 切片」到「可售可交」的硬缺口。
> 验收口径：每个任务完成后，`examples/data_suite/golden-path/` 端到端跑通且 admin 可运营。

## 背景：当前缺口（基于 main @ 223946eb6 的代码事实）

A1~A8 垂直切片已合入（44 源码文件 + 53 测试），但：

1. **通道不全**：`channels/` 只有 ClickHouse / JDBC / Kafka / Fake；缺文件通道（SFTP/OSS，真实项目双云专线文件同步的主通道）与 Hive/Spark Thrift（客户侧主流湖仓算力）。
2. **管理台是 fixture**：A4 治理 / A6 看板 admin 页面多数读 fixture，无真 CRUD、无持久化，客户无法日常运营字典与质量流水线。
3. **调度未深绑**：A2 的 scheduler 与 managed schedule/运维面（重跑 / 补数 / 回放）未打通。
4. **认证路由未收口**：A7 已有 AuthStrategyRegistry，但 SSO 路由未全面切换到 registry。
5. **取数权限链路未闭环**：A6 自助取数 API 与脱敏 / 数据权限策略未联动。
6. **A8 无 LLM 闭环**：NL2SQL 模板无真实 LLM 接入；metering 计费、MA schedules 管理 UI 缺失。
7. **A5 未下推真通道**：标签圈选 DSL 只在 Fake/内存通道验证过。

## 子任务清单（按交付优先级排序，建议串行）

| # | 任务 | 范围 | Suggested-Impl-Model | 优先级 |
|---|------|------|----------------------|--------|
| H1 | 文件通道（SFTP/OSS） | `channels/file.py`：文件清单发现、批量下载/上传、分区目录约定（date=YYYYMMDD）、断点续传与失败重试、凭据走 credentials binder；探查（schema 推断 + 样本预览） | gpt-5.6-sol-medium | P0 |
| H2 | Hive/Spark Thrift 通道 | `channels/hive.py`：Thrift 连接、只读默认 / grants 授权写、探查（表/分区元数据）、与 ClickHouse 通道同等 e2e | gpt-5.3-codex | P0 |
| H3 | A4 治理管理台真 CRUD + 持久化 | governance admin 页从 fixture 升级为真 API：字典 / 清洗规则 / 分级 / 质量流水线落 `store/`（SQLite/文件仓即可），支持增删改查、审核动作、日更任务真实运行 | gpt-5.6-sol-medium | P0 |
| H4 | A7 认证路由全面 registry 化 | 现有 OIDC / Keycloak SSO 路由全部改走 `AuthStrategyRegistry`，新增一种认证方式只需注册 strategy 插件；补集成测试证明切换零行为回归 | gpt-5.6-sol-medium | P0 |
| H5 | A6 看板 portal 产品化 + 取数权限闭环 | dashboard boards 从 admin e2e 走向 portal 常驻入口；自助取数 API 强制经过 masking policy + 数据权限校验；越权用例 e2e | gpt-5.6-sol-medium | P1 |
| H6 | A2 调度深绑 managed schedule + 运维面 | DataFlow 作业挂到 managed `schedule/schedule_run`；admin 增加作业运维页：运行历史、重跑 / 补数 / 快照回放、失败告警（webhook sink 复用 A8） | gpt-5.6-sol-medium | P1 |
| H7 | A3 ID-Mapping 管理台 | idmapping 的 profile 配置页、冲突审阅队列（人工裁决合并）、快照对比视图 | gpt-5.3-codex | P1 |
| H8 | A5 标签圈选下推真通道 | audience DSL 编译目标从 Fake 扩展到 ClickHouse / JDBC（下推查询），圈选结果走 masking；带量级基准测试 | gpt-5.3-codex | P1 |
| H9 | A8 NL2SQL LLM 闭环 + metering | nl2sql 模板接真实 LLM（复用 runtime llms 供应商层 + write guards 只读白名单）；巡检 Agent 计量入 metering；MA schedules 管理 UI | gpt-5.6-sol-medium | P2 |
| H10 | golden-path 扩展与产品口径文档 | golden-path 增加文件通道 / Hive 场景与 A2 运维面演示步骤；产出「能力地图 vs 验收缺口」一页（脱敏口径，供售前引用） | gpt-5.3-codex | P1 |

## Done-when（整体验收）

1. `examples/data_suite/golden-path/` 一条命令跑通：**文件通道 / Hive 通道探查 → DataFlow 作业 → ID-Mapping → 字典/质量 → 标签圈选（真通道下推）→ 看板 → 脱敏水印 → 巡检 webhook**。
2. admin 治理 / 看板 / 作业运维三个管理台页面可真实运营（增删改查 + 持久化 + 运行历史），非 fixture。
3. 新增一种认证方式 = 注册一个 strategy 插件，不改核心路由。
4. 所有新通道遵守「默认只读、授权可写」+ 凭据不落明文。
5. 工程边界纪律不变：本计划全部进主仓主干；项目 / 客户专属配置继续走 `examples/data_suite/delivery_pack/` 的 B 层形态，不回渗引擎。

## 与既有计划的关系

- 本计划 = after-a8-roadmap **Track 2** 的展开与重排（把「按缺口补」细化为 H1~H10 与 Done-when），不推翻 Track 0/1/3 已完成部分（P3 spine、P4 B-pack 已合入）。
- H1/H2 完成后 A1 即满足总纲 A1 的原验收（五类通道齐）。
- 建议按 H1 → H2 → H4 → H3 → H6 → H5 → H7 → H8 → H10 → H9 串行推进；P0 四项完成即达到「数据项目投标可演示」状态。
