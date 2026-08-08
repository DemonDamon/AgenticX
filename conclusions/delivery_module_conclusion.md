# Delivery 模块结论

## Responsibility

`agenticx/delivery` 实现 Near Desktop「交付闭环」的 POC/MVP 编排：从客户输入材料出发，在隔离 git worktree 中按固定五阶段流水线（需求 → 设计 → 前端 POC → 测试 → 审计）生成可验收产物，并用 `plan.mdc` 与 `~/.agenticx/delivery/tasks.json` 追踪任务状态。启动前通过 `ensure_delivery_bundle()` 安装 `agenticx-delivery-kit` bundle、物化交付分身 preset，并可把 Figma token 写入 `~/.agenticx/mcp.json`。当前阶段执行为文件系统 stub（`materialize_stage_artifacts`），并非真实委派各 `delivery-*` 分身跑 Agent 会话。

## Entry points and public interfaces

- **Python API**：`DeliveryOrchestrator`（`start_delivery` / `resume_delivery` / `list_tasks` / `get_task`）、`TaskSpec`、`get_delivery_config` / `save_delivery_config`（`agenticx/delivery/__init__.py` 仅导出 orchestrator 与 config 读取）。
- **Studio REST**（`agenticx/studio/delivery_api.py`，由 `server.py` 注册）：`GET/PUT /api/delivery/config`、`GET/POST /api/delivery/tasks`、`GET /api/delivery/tasks/{task_id}`、`POST /api/delivery/tasks/{task_id}/resume`、`POST /api/delivery/bootstrap`；均需 `x-agx-desktop-token`。
- **Bootstrap**：`ensure_delivery_bundle()`、`materialize_delivery_avatars()` 供 orchestrator 与 bootstrap 端点调用。

## Core execution path

1. `DeliveryOrchestrator.start_delivery(TaskSpec)` 检查 `delivery.enabled`，调用 `ensure_delivery_bundle()`。
2. `resolve_repo_root()` 定位 git 根（配置 `delivery.repo_root` 或 CWD 向上查找）；`create_worktree()` 在干净工作树下 `git worktree add -B delivery/{slug}` 创建沙箱。
3. 复制 `input_files` 到 `{worktree}/input/{task_id}/`，初始化 `output/{task_id}/`，`default_plan()` + `write_plan()` 写入 `{worktree}/plan.mdc`，`upsert_task()` 登记 `DeliveryTaskRecord`。
4. `dry_run=True`（`AGX_DELIVERY_DRY_RUN` 或 config）时同步跑 `_run_pipeline_sync`；否则 `asyncio.create_task` 后台执行。
5. `_run_pipeline_sync` 按 `STAGE_ORDER` 迭代：`materialize_stage_artifacts` → `validate_stage_artifacts`；失败则重试至 `max_stage_retries`，超限置 `awaiting_user`；成功则 `update_stage(..., status="completed")` 并推进 `next_stage`。全程回写 `plan.mdc` 与 tasks 索引。

## Important classes and functions

| 符号 | 角色 |
|------|------|
| `DeliveryOrchestrator` | 任务创建、恢复、流水线调度 |
| `TaskSpec` | 创建载荷：`project_name`、`target`（默认 POC）、`input_files`、`industry_template` |
| `DeliveryTaskRecord` | 持久化索引：task_id、slug、status、路径字段 |
| `DeliveryPlan` / `StageState` | 解析/写入 `plan.mdc` 的结构 |
| `STAGE_ORDER` / `STAGE_LABELS` | 五阶段 ID 与中文标签 |
| `_avatar_for_stage()` | 阶段到分身 ID 映射（如 `requirements` → `delivery-analyst`） |
| `materialize_stage_artifacts` / `validate_stage_artifacts` | 阶段产物生成与轻量校验 |
| `ensure_delivery_bundle` | bundle 安装 + 分身 YAML 物化 + Figma MCP env 补丁 |
| `create_worktree` / `resolve_repo_root` / `WorktreeError` | git worktree 沙箱 |
| `get_delivery_config` / `save_delivery_config` | 读取/合并 `delivery.*` 配置 |

## Data and configuration

- **全局配置**（`~/.agenticx/config.yaml` 的 `delivery` 节，经 `get_delivery_config()` 合并默认值）：`enabled`、`worktree_root`（默认 `~/.agenticx/deliveries`）、`bundle_source`（默认可解析到 `examples/agenticx-for-delivery`）、`figma_token`、`playwright_browsers`、`max_stage_retries`、`repo_root`；环境变量 `AGX_DELIVERY_ENABLED`、`AGX_DELIVERY_DRY_RUN`、`FIGMA_API_KEY` / `FIGMA_TOKEN` 可覆盖。
- **任务索引**：`~/.agenticx/delivery/tasks.json`，键为 `task_id` → `DeliveryTaskRecord` 字典。
- **每任务工件**：worktree 内 `plan.mdc`（JSON frontmatter + Markdown 阶段块）、`output/{task_id}/` 下各阶段文件（如 `requirement-breakdown.md`、`design/`、`frontend/`、`qa/playwright-report/`、`delivery-summary.md`）。
- **Bundle/分身**：`examples/agenticx-for-delivery`（含 `agx-bundle.yaml` 与 `avatars/*.yaml`）；物化到 `~/.agenticx/avatars/delivery-{analyst,designer,frontend,qa}/`。

## Dependencies

- **`agenticx.extensions.installer`**：`install_bundle` / `list_installed_bundles` 安装 delivery kit。
- **`agenticx.avatar.registry`**：`AvatarRegistry`、`AvatarConfig`、`AVATARS_ROOT` 物化 preset 分身。
- **Git CLI**：worktree 创建与 dirty 检查（`subprocess` 调用 `git`）。
- **Studio 层**：`delivery_api.register_delivery_routes` 挂 REST；Desktop 侧消费这些端点（本模块不内含 UI）。

## Tests and operations

- `tests/test_smoke_delivery_loop.py`：mock worktree/bootstrap/config 后验证 `start_delivery` 五阶段跑通、`plan.mdc` 阶段状态与 `tasks.json` 一致性。
- **运行前提**：目标 git 仓库工作树须干净；bundle 源目录存在且可安装；本地需可执行 `git`。
- **恢复**：`resume_delivery(task_id)` 将 status 置 `running` 并重新调度后台 pipeline（从 `plan.mdc` 未 completed 阶段继续）。

## Unverified or ambiguous

- `materialize_stage_artifacts` 注释称 live 模式为 scaffold，但 orchestrator 无论 `dry_run` 均走同一函数——当前无分支调用真实 LLM/分身执行，`plan.mdc` 中的 `avatar_id` 仅作文档字段。
- `TaskSpec.industry_template` 在 orchestrator/stages 路径中未被读取，可能为预留字段。
- `industry_template` 与 REST `POST /api/delivery/tasks` 已接收但未参与流水线逻辑。
