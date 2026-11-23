# Data Suite 模块结论

> 结论更新时间：2026-11-14（首次建档，基线覆盖至 `cebdabd5`）

## Responsibility
- `agenticx/data_suite` 提供一组可组合的企业数据处理内核：统一数据通道、声明式 DataFlow 作业、ID 归并与快照、数据治理、标签/受众、仪表盘绑定，以及查询 ACL 与字段脱敏。
- 模块同时提供交付包加载/注册和轻量 JSON 文件存储，使字典、看板、清洗规则、质量指标、分级与审核动作可在无外部控制面的进程内落地。
- Explicit non-responsibilities: 不提供独立 HTTP API、Web UI 或常驻 worker；不实现分布式 DAG、事务编排或跨进程调度；`DataJobOpsService` 的作业、计划与运行历史只保存在当前进程。
- Explicit non-responsibilities: Kafka、Hive/Spark Thrift、SFTP/对象存储的 live transport 尚未接线，只有内存/注入 transport；`register_pack` 当前只注册 `kind=fake` 通道，quality/audience/IAM 仅解析并计数或记录 ID，不执行规则或发布策略。
- Explicit non-responsibilities: 不内置客户 ID schema、业务字段或完整权限系统；ACL、masking、ID-Mapping、tag 与 board 均由调用方提供通用配置。DataFlow 的 snapshot 是进程内记录，`DataJobOpsService.replay_snapshot` 只重新执行 `JobSpec` 并关联旧 snapshot ID，不恢复旧行数据。

## Entry points and public interfaces
- 包根 `agenticx/data_suite/__init__.py` 只声明 `channels`、`jobs`、`idmapping` 三个顶层命名空间；实际公共面主要由各子包 `__init__.py` 聚合。
- 通道入口（`agenticx/data_suite/channels/`）：`DataChannel` Protocol、`ChannelRegistry`、`build_channel`、`ChannelProbeResult` / `ChannelQueryResult`，以及 `FakeChannel`、`ClickHouseChannel`、`JdbcChannel`、`KafkaChannel`、`HiveChannel`、`FileChannel`。所有写入统一经 `WriteGrantStore` 校验，失败抛 `WriteDeniedError`。
- 作业入口（`agenticx/data_suite/jobs/`）：`load_job` 将 YAML 解析为 `JobSpec` / `JobNode`；`run_job` 按声明顺序执行；`DataJobScheduler` 做五段 cron 匹配；`DataJobOpsService` 提供注册、绑定 schedule、tick、rerun、backfill、replay 与运行历史序列化。
- 身份归并入口（`agenticx/data_suite/idmapping/`）：`IdMappingEngine`、`IdMapProfile`、`SnapshotStore` 和 `IdMappingAdminService`，覆盖 profile YAML/JSON、记录归并、冲突队列、不可变快照回放与快照比较。
- 安全自助查询入口（`agenticx/data_suite/acl/`、`masking/`、`audience/`）：`check_query_access` / `assert_query_access`、`secure_query_rows` / `secure_bind_widget`、`MaskingEngine`、`select_audience`、`compile_audience_sql` / `pushdown_select`。受保护路径先做 ACL，再强制 masking。
- 治理和展示入口：`CleaningEngine`、`DictionaryCatalog`、`QualityRollup`、`TrustArbiter`、`build_lineage_graph`；`TagCatalog` / `TagComputeEngine`；`load_board` / `bind_widget` / `apply_drill` / `compare_series`。
- 交付与持久化入口（`agenticx/data_suite/pack/`、`store/`）：`load_pack` / `register_pack` / `RegisterReport`，以及 `DictionaryFileStore`、`BoardFileStore`、`CleaningRuleStore`、`ClassificationStore`、`QualityMetricStore`、`ReviewActionStore`。

## Core execution path
- **通道构建与访问**：`load_channel_config(name)` 从 `ConfigManager` 读取 `data_suite.channels.<name>` → `build_channel` 按 `kind` 选择具体 `DataChannel` → `ChannelRegistry.register/get/probe_all` 管理实例。查询返回列/行结构；ClickHouse/JDBC 查询先经 `agenticx.connectors.database.check_read_only_sql`，其余内存型通道仅接受 `SELECT * FROM <table|topic>`。写入必须匹配 `grant_id + channel + table`，成功后追加内存 audit。
- **DataFlow 执行**：`load_job` 校验 `extract|clean|transform|load|snapshot` 节点 → `run_job` 依声明顺序串行分派到 `run_extract`、`run_clean`、`run_transform`、`run_load`、`run_snapshot` → `LineageLog.record` 为每个已执行节点追加事件。transform 使用指定 `IdMapLike`，缺省回退 `PassthroughIdMap`；任一异常被收敛为 `JobRunResult(ok=False, error=...)`。
- **作业运维**：`DataJobOpsService.bind_schedule` 保存五段 cron → `tick` 用 `cron_matches` 找到 due schedule → `_execute` 调用 `run_job` 并更新 `DataJobScheduleRun`；失败通过 `WebhookNotifier` 发出 `data_job.run_failed`。手工重跑、补数与 replay 共用同一执行路径。
- **ID-Mapping**：profile 定义 ID 类型、canonical priority 与 `prefer_priority|reject` 冲突策略 → `IdMappingEngine.merge` 用 union-find 按共享 ID 值聚类 → 生成 `subject_id`、links、conflicts → `SnapshotStore.save` 写内存及可选 JSON。`IdMappingAdminService` 将 profile、snapshot、conflicts 落到 `root/idmapping/`，并支持冲突裁决和两快照 subject/link 差异比较。
- **治理与消费**：`CleaningEngine` 顺序应用 `not_null|regex|in_set|trim` 并产出 survivors、quarantine、audit；`QualityRollup` 计算 `null_rate|distinct_count|rule_fail_rate`；`TrustArbiter` 按 grade rank/source order 选值；`build_lineage_graph` 从 job event 的 `meta.tables_in/tables_out` 构造表级图。标签可由 `TagComputeEngine` 计算后交给内存 audience DSL 或 SQL pushdown 筛选。
- **安全查询与看板**：ACL 按 role → dataset → board → fields 判定；`secure_query_rows` 和 `secure_bind_widget` 在允许后强制应用 `MaskingEngine` 的 `full|partial|hash|drop` 策略。`bind_widget` 再过滤、分组并执行 `count|sum|avg`，输出 `ChartSeries`；drill 和 compare 是对同行数据的过滤/双绑定。
- **交付包应用**：`load_pack` 读取 `pack.yaml` 及 channels/dictionary/quality/tags/boards/idmapping/iam sections → `register_pack` 将 fake channel、字典字段、board、tag 写入调用方 registry/store/catalog，并解析 ID-Mapping profile；quality、audience、IAM 只进入 `RegisterReport`。

## Data and configuration
- 通道主配置位于 `ConfigManager` 的 `data_suite.channels.<name>`；`build_channel` 识别 `clickhouse|jdbc|sql|postgres|postgresql|mysql|sqlite|kafka|file|hive|spark|sparksql|fake`。`redact_secrets` 会递归遮蔽名称含 password/token/secret/api_key/apikey/access_key 的字段。
- ClickHouse 还支持 `AGX_CH_URL`，或 `AGX_CH_HOST` / `AGX_CH_PORT` / `AGX_CH_USER` / `AGX_CH_PASSWORD` / `AGX_CH_DATABASE`。文件型管理存储按显式 `root` → `AGX_DATA_SUITE_STORE_DIR` → `cwd/.runtime/data-suite` 解析。
- YAML 契约包括 job（`name/nodes/schedule`）、ACL（`default_effect/grants`）、masking（`rules/strategies`）、board（`widgets`）、dictionary、cleaning、quality、trust、tags/computes、ID-Mapping profile 与 delivery `pack.yaml`；加载器会拒绝未知 node/chart/masking/conflict 类型。
- `SnapshotStore` 可纯内存运行，也可将 ID-Mapping snapshot 写为 `<snapshot_id>.json`；`IdMappingAdminService` 另写 `profiles/*.{yaml,json}` 与 `conflicts.json`。通用 stores 分别维护 `dictionary.json`、`boards.json`、`cleaning_rules.json`、`classification.json`、`quality_metrics.json`、`review_actions.json`。
- `ClassificationStore` 首次初始化会落盘默认 S/A/B/C 等级。`ReviewActionStore` 是 append-only；其余 file stores 以 ID/name upsert。`DatasetStore` 则只是从一个 JSON 文件装载 dataset → rows 的进程内看板数据。

## Dependencies
- 核心依赖：标准库 dataclass/json/pathlib/asyncio 形态与 `PyYAML`；通道配置依赖 `agenticx.cli.config_manager.ConfigManager`，SQL 只读校验复用 `agenticx.connectors.database.check_read_only_sql`。
- 可选运行依赖：`ClickHouseChannel` 延迟导入 `clickhouse_connect`；`JdbcChannel` 延迟导入 SQLAlchemy，并由目标方提供 psycopg2/PyMySQL 等 driver；Kafka 与 Hive 仅检查可选 client 包，当前 live transport 仍明确报 deferred。
- 模块内耦合：jobs 依赖 channels 和可插拔 `IdMapLike`；governance lineage 依赖 `jobs.LineageLog`；ACL secure path 依赖 dashboard 与 masking；audience pushdown 依赖 `DataChannel.query` 兼容形状。
- 跨模块依赖：`DataJobOpsService` 复用 `agenticx.managed.templates.data_suite.webhook` 的 `WebhookNotifier`、`FakeWebhookSink`、`HttpWebhookSink`；`agenticx/knowledge/lifecycle/idmap_hook.py` 使用本模块 ID-Mapping 能力。

## Tests and operations
- `tests/data_suite/` 在该基线包含 175 个测试，覆盖 channel factory/probe/query/grant、ClickHouse/JDBC 只读保护、Kafka/Hive/File 注入 transport 与重试、DataFlow DSL/runner/scheduler/ops、ID-Mapping、治理、ACL/masking、audience pushdown、dashboard、pack 和 file stores。
- 端到端路径由 `tests/data_suite/test_golden_path_e2e.py`、`test_golden_path_job.py`、`test_golden_path_ops.py`、`test_delivery_pack_e2e.py` 等串起；安全闭环由 `test_query_acl.py`、`test_dashboard_mask_bind.py`、`test_audience_pushdown.py` 验证。
- 外部集成测试另见 `tests/knowledge/lifecycle/test_idmap_hook.py` 与 `tests/managed/templates/test_dict_drift.py`。live ClickHouse 测试按环境可跳过，其余通道以 fake/in-memory/injected client 为主要 CI 边界。
- 维护时优先执行 `python -m pytest -q tests/data_suite`；涉及知识生命周期或 managed data-suite 模板时，再补跑上述两个跨模块测试目录。
- 运维限制：cron 只支持五段、`*`/单值/逗号列表，不支持 ranges/steps；run/schedule history、write-grant audit、job snapshot 默认不跨进程持久化；File/Hive/Kafka endpoint 配置存在时，当前 probe 会返回明确失败而不是建立真实连接。
