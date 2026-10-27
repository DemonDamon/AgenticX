# Delivery 模块结论

> 结论更新时间：2026-10-25（覆盖基线 `ca9d92bec056` 至 `22d051f5d18a` 的变更）

## Responsibility

`agenticx/delivery` 实现 Near Desktop「交付闭环」的 POC/MVP 编排：从客户输入材料出发，在隔离 git worktree 中按固定五阶段流水线（需求 → 设计 → 前端 POC → 测试 → 审计）生成可验收产物，并用 `plan.mdc` 与 `~/.agenticx/delivery/tasks.json` 追踪任务状态。启动前通过 `ensure_delivery_bundle()` 安装 `agenticx-delivery-kit` bundle、物化交付分身 preset，并可把 Figma token 写入 `~/.agenticx/mcp.json`。非 dry-run 且 LLM 可用时，`requirements`/`design` 经 `stage_agents.make_stage_agent` 真实生成产物；其余阶段仍为模板 stub。校验为两级质量门：`validate_stage_with_gate`（文件 fast path + 可选 `llm_gate_judge`）。

## Entry points and public interfaces

- **Python API**：`DeliveryOrchestrator`（`start_delivery` / `resume_delivery` / `list_tasks` / `get_task`）、`TaskSpec`、`get_delivery_config` / `save_delivery_config`（`agenticx/delivery/__init__.py` 仅导出 orchestrator 与 config 读取）。
- **Studio REST**（`agenticx/studio/delivery_api.py`，由 `server.py` 注册）：`GET/PUT /api/delivery/config`、`GET/POST /api/delivery/tasks`、`GET /api/delivery/tasks/{task_id}`、`POST /api/delivery/tasks/{task_id}/resume`、`POST /api/delivery/bootstrap`；均需 `x-agx-desktop-token`。
- **Bootstrap**：`ensure_delivery_bundle()`、`materialize_delivery_avatars()` 供 orchestrator 与 bootstrap 端点调用。

## Core execution path

1. `DeliveryOrchestrator.start_delivery(TaskSpec)` 检查 `delivery.enabled`，调用 `ensure_delivery_bundle()`。
2. `resolve_repo_root()` 定位 git 根（配置 `delivery.repo_root` 或 CWD 向上查找）；`create_worktree()` 在干净工作树下 `git worktree add -B delivery/{slug}` 创建沙箱。
3. 复制 `input_files` 到 `{worktree}/input/{task_id}/`，初始化 `output/{task_id}/`，`default_plan()` + `write_plan()` 写入 `{worktree}/plan.mdc`，`upsert_task()` 登记 `DeliveryTaskRecord`。
4. `dry_run=True`（`AGX_DELIVERY_DRY_RUN` 或 config）时同步跑 `_run_pipeline_sync`；否则 `asyncio.create_task` 后台执行。
5. `_run_pipeline_sync` 按 `STAGE_ORDER` 迭代：`default_llm_factory()`（dry-run 或 LLM 不可用则为 `None`）→ `make_stage_agent` → `materialize_stage_artifacts(..., intent=plan.intent, stage_agent=...)` → `validate_stage_with_gate(..., gate_criteria=stage.gate_criteria, llm_judge=llm_gate_judge)`；失败则重试至 `max_stage_retries`，超限置 `awaiting_user`；成功则 `update_stage(..., status="completed")`、可选 `on_stage_passed` 回调，并推进 `next_stage`。全程回写 `plan.mdc` 与 tasks 索引。

## Important classes and functions

| 符号 | 角色 |
|------|------|
| `DeliveryOrchestrator` | 任务创建、恢复、流水线调度 |
| `TaskSpec` | 创建载荷：`project_name`、`target`（默认 POC）、`input_files`、`industry_template` |
| `DeliveryTaskRecord` | 持久化索引：task_id、slug、status、路径字段 |
| `DeliveryPlan` / `StageState` | 解析/写入 `plan.mdc` 的结构 |
| `STAGE_ORDER` / `STAGE_LABELS` | 五阶段 ID 与中文标签 |
| `_avatar_for_stage()` | 阶段到分身 ID 映射（如 `requirements` → `delivery-analyst`） |
| `stage_agents`（`make_stage_agent` / `llm_gate_judge` / `default_llm_factory`） | SP-B：`requirements`/`design` LLM 生成与 Gate 评审（复用 `brain.wiki_compiler._invoke_llm`） |
| `materialize_stage_artifacts` / `validate_stage_artifacts` | 阶段产物生成与文件存在性校验 |
| `GateVerdict` / `validate_stage_with_gate` | Plan DSL v1 两级质量门（fast path + 可选 LLM judge） |
| `ensure_delivery_bundle` | bundle 安装 + 分身 YAML 物化 + Figma MCP env 补丁 |
| `create_worktree` / `resolve_repo_root` / `WorktreeError` | git worktree 沙箱 |
| `get_delivery_config` / `save_delivery_config` | 读取/合并 `delivery.*` 配置 |
| `defaults()` / `_default_worktree_root()` | 惰性求值默认配置：`worktree_root` 按调用时 HOME 解析，不再 import 时定死 |
| `_store_root()`（store.py） | 惰性解析 `~/.agenticx/delivery`，PEP 562 `__getattr__` 保留 `_STORE_ROOT` 外部可读 |

## Data and configuration

- **全局配置**（`~/.agenticx/config.yaml` 的 `delivery` 节，经 `get_delivery_config()` 合并默认值）：`enabled`、`worktree_root`（生效默认仍为 `~/.agenticx/deliveries`，但 `DEFAULTS["worktree_root"]` 已改为占位空串，真实值由 `defaults()` → `_default_worktree_root()` 在每次调用时经 `agx_home()` 按当前 HOME 重算，避免 import 期 `Path.home()` 定死导致测试 HOME 重定向失效、交付产物写入开发者真实目录）、`bundle_source`（默认可解析到 `examples/agenticx-for-delivery`）、`figma_token`、`playwright_browsers`、`max_stage_retries`、`repo_root`；环境变量 `AGX_DELIVERY_ENABLED`、`AGX_DELIVERY_DRY_RUN`、`FIGMA_API_KEY` / `FIGMA_TOKEN` 可覆盖。
- **任务索引**：`~/.agenticx/delivery/tasks.json`，键为 `task_id` → `DeliveryTaskRecord` 字典。存储根目录改由 `_store_root()` 惰性解析（`lazy_home_path(__name__, "_STORE_ROOT", "delivery")`，支持既有测试对模块属性 `_STORE_ROOT` 的 monkeypatch 覆盖）；模块级 `_TASKS_JSON` 仍在 import 时由 `_store_root()` 算出。
- **每任务工件**：worktree 内 `plan.mdc`（JSON frontmatter + Markdown 阶段块；Plan DSL v1 扩展 `intent`/`scope`/`case_refs` 及每阶段 `gate_criteria`/`artifact_refs`/`case_link`，旧文件缺键则默认空）、`output/{task_id}/` 下各阶段文件（如 `requirement-breakdown.md`、`design/`、`frontend/`、`qa/playwright-report/`、`delivery-summary.md`）。
- **Bundle/分身**：`examples/agenticx-for-delivery`（含 `agx-bundle.yaml` 与 `avatars/*.yaml`）；物化到 `~/.agenticx/avatars/delivery-{analyst,designer,frontend,qa}/`。

## Dependencies

- **`agenticx.extensions.installer`**：`install_bundle` / `list_installed_bundles` 安装 delivery kit。
- **`agenticx.utils.agx_home`**：`agx_home()` / `lazy_home_path()` 提供 `~/.agenticx` 路径的惰性解析，config 与 store 的默认目录均改走它。
- **`agenticx.avatar.registry`**：`AvatarRegistry`、`AvatarConfig`、`AVATARS_ROOT` 物化 preset 分身。
- **`agenticx.brain.wiki_compiler` / `agenticx.llms.provider_resolver`**：stage agent 与 gate judge 的 LLM 调用与 provider 探测。
- **Git CLI**：worktree 创建与 dirty 检查（`subprocess` 调用 `git`）。
- **Studio 层**：`delivery_api.register_delivery_routes` 挂 REST；Desktop 侧消费这些端点（本模块不内含 UI）。

## Tests and operations

- `tests/test_smoke_delivery_loop.py`：mock worktree/bootstrap/config 后验证 `start_delivery` 五阶段跑通、`plan.mdc` 阶段状态与 `tasks.json` 一致性。
- **运行前提**：目标 git 仓库工作树须干净；bundle 源目录存在且可安装；本地需可执行 `git`。
- **恢复**：`resume_delivery(task_id)` 将 status 置 `running` 并重新调度后台 pipeline（从 `plan.mdc` 未 completed 阶段继续）。

## Unverified or ambiguous

- `development`/`testing`/`audit` 仍走 stub 模板；`plan.mdc` 的 `avatar_id` 仍未驱动真实分身会话委派。
- `DeliveryPlan.intent`/`scope`/`case_refs` 与 `StageState.case_link`/`artifact_refs` 已读写 frontmatter，但 orchestrator 创建任务时尚未填充 `intent`（除 stage agent 用 `project_name` 回退）；`case_refs`/`case_link` 为 SP-C/SP-D 预留。
- `TaskSpec.industry_template` 与 REST `POST /api/delivery/tasks` 已接收但未参与流水线逻辑。
