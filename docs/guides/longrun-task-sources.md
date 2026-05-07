# Long-run 任务源（Symphony 内化）

`agenticx/longrun/` 提供按任务隔离工作目录、stall/retry/token 记账与编排循环。默认**关闭**，需在 `~/.agenticx/config.yaml` 设置 `longrun.enabled: true` 或导出 `AGX_LONGRUN_ENABLED=1` 后由 Studio `lifespan` 拉起。

## 启用与 Studio API

- **GET** `/api/longrun/state` — 只读快照：`counts`（running / retrying / done / failed）与各任务的 `state`、`attempt_failures`、`workspace_path`、`tokens`。
- **POST** `/api/longrun/tasks` — 手动入队：`{"id":"...", "task":"..."}`（或 `prompt`）；若配置了 `AGX_DESKTOP_TOKEN`，请求头需带 `x-agx-desktop-token`。
- **POST** `/api/longrun/webhook/enqueue` — 批量：`{"tasks":[{"id":"...","task":"..."}]}`。

关闭开关时 **不会** import `agenticx/longrun/orchestrator.py`（仅 `bootstrap.maybe_start_longrun` 在 lifespan 内按需加载）。

## 内置任务源

| 来源 | 说明 |
|------|------|
| **ManualSource** | HTTP/Webhook 入队（见上）。 |
| **CronSource** | 读取自动化任务列表；仅当条目含 **`longrun_server_dispatch: true`** 时才转为 Long-run 待处理任务，避免与桌面默认定时执行路径冲突。 |
| **LinearTaskSource**（可选） | 配置 `longrun.linear_api_key` 或环境变量 `LINEAR_API_KEY` 后启用；可选 `longrun.linear_team_ids` 过滤。 |

合并顺序：Manual + Cron +（可选）Linear，按 `id` 去重。

## 子任务 continuation

编排器根据 `submit_fn` 返回的 `wants_continuation` 决定是否以 **continuation delay** 重新调度同一条任务。

使用真实 `AgentTeamManager.submit_for_longrun` 时：

1. 可在入队 payload 中显式设置 `"wants_continuation": true`。
2. 或若子智能体最终回复文本中包含 **不区分大小写** 的子串 `[longrun:continue]`，亦视为需要延续。

## 配置示例

参见仓库 `docs/examples/longrun-linear.yaml`。

## 任务工作区钩子

事件键与现有 hooks 注册一致：`task_workspace:after_create`、`before_run`、`after_run`、`before_remove`。可在 `~/.agenticx/hooks/` 下用声明式 `HOOK.yaml` 或 `register_hook` 注册。
