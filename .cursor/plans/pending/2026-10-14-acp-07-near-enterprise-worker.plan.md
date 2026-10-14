# acp-07 Near 作为企业 Worker

Planned-with: Claude Opus 5.5
Suggested-Impl-Model: Grok 4.7
Parent: `.cursor/plans/2026-10-14-acp-master.plan.md`
Depends: acp-06（`/api/desktop/worker/*` 协议）、acp-03（回合 Trace 自动上报，无需额外改动）

## 目标

员工在 Near「账号」页打开「让这台电脑承接企业智能体任务」后，本机 `agx serve` 向企业发心跳、认领 `desktop_worker` 任务，用本机模型与本地工作区执行，再把结果回写房间。关掉开关后立即停止认领，无需重启。

## 根因与证据

- 企业配置：`enterprise.enabled`、`enterprise.token`（PAT）、`enterprise.base_url`（读法见 `agenticx/runtime/action_audit.py` 约 59–70 行）。
- `agx serve`（`agenticx/cli/main.py` 约 598–635 行）设置 `AGX_SERVE_PORT` 与 `AGX_DESKTOP_TOKEN` 环境变量，并写 `~/.agenticx/serve.port`。
- Studio 生命周期 `_studio_lifespan`（`agenticx/studio/server.py` 约 949 行）里已经启动若干后台任务。
- 对话入口 `POST /api/chat`（SSE，事件 JSON 形如 `{"type": ..., "data": ...}`，结束有 `final` 与 `done`，见 server.py 约 2980–2991 行）；确认入口 `POST /api/confirm`（约 2740 行）。实施前读这两处，确认事件名（文本增量、工具调用、确认请求）与确认请求体字段。
- 分身：`AvatarRegistry.create_avatar()`（`agenticx/avatar/registry.py`），新建会话 `POST /api/sessions`（带 `avatar_id`）。
- Near 账号页：`desktop/src/components/AccountTab.tsx`；企业登录 IPC 在 `desktop/electron/main.ts`（`load-enterprise-account`）与 `desktop/electron/preload.ts`。

## 设计

### Python：`agenticx/runtime/enterprise_worker.py`

```python
STATE_DIR = ~/.agenticx/enterprise_worker/      # 跟随 ConfigManager home 解析
DEVICE_FILE = STATE_DIR / "device.json"          # {"device_id": "near-<uuid4 hex>"}，首次生成后不变
STATE_FILE = STATE_DIR / "state.json"            # {"avatars": {agent_id: avatar_id}, "sessions": {"<agent_id>:<room_id>": session_id}}

HEARTBEAT_INTERVAL_S = 15
CLAIM_INTERVAL_S = 3

def worker_enabled() -> bool:
    # enterprise.enabled is True and token、base_url 非空 and ConfigManager.get_value("enterprise.worker.enabled") is True

class EnterpriseWorker:
    def __init__(self, *, local_base_url: str, desktop_token: str | None, http: httpx.AsyncClient | None = None): ...
    async def run_forever(self) -> None: ...   # 每轮重新读配置；未启用时 sleep 5s 继续
    async def run_once(self) -> bool: ...      # 心跳到期则心跳；空闲时认领并执行一个任务；返回是否执行了任务
    def status(self) -> dict: ...              # enabled, running, device_id, agents, last_heartbeat_at, current_task_id, last_error
```

执行一个任务（`_execute(task)`）：

1. 确保本地分身：`state.avatars[agent.id]` 不存在或已被删除时，用 `AvatarRegistry` 创建名为 `企业·{displayName}` 的分身，`system_prompt = agent.systemPrompt`，`tags=["enterprise"]`；已存在但提示词变化时更新。不设置 default_model（用本机默认模型；企业 `model` 字段只写进结果 metadata 供审计）。
2. 确保会话：`state.sessions["<agent_id>:<room_id>"]` 不存在时 `POST {local}/api/sessions` 带 `avatar_id` 创建，并保存。
3. 组织输入：把 `task.input.messages` 渲染成「房间最近对话」文本块（每行 `名字：内容`），后接 `请回应：{instruction}`。
4. `POST {local}/api/chat`（带 `x-agx-desktop-token`），消费 SSE：累积最终回答文本；记录工具调用名与成败为 `tool_steps`；收到确认请求时，调用 `/api/confirm` 选择拒绝，并在 `tool_steps` 记 `{"tool": <名>, "ok": false, "denied": true}`；整轮超时 8 分钟（小于企业 10 分钟租约）。
5. 成功：`POST {base_url}/api/desktop/worker/tasks/{id}/complete`，body `{device_id, content, tool_steps}`；`content` 去掉 `<think>…</think>`，为空时改走 fail。
6. 任何异常：`.../fail`，`error` 用异常摘要（不含本机路径以外的敏感信息，不含 token）。

HTTP：访问企业用 `Authorization: Bearer <enterprise.token>`；访问 `127.0.0.1` 用 `trust_env=False`。401 时暂停认领 60 秒并把 `last_error` 设为「企业登录已失效」。同一时刻只执行一个任务。

### Studio 接线（`agenticx/studio/server.py`，只做精确新增）

- 顶部 import 区按字母序新增一行 `from agenticx.runtime.enterprise_worker import EnterpriseWorker`。
- `_studio_lifespan` 中，在现有后台任务启动处之后新增一个块：用 `os.environ.get("AGX_SERVE_PORT", "8000")` 与 `AGX_DESKTOP_TOKEN` 构造 `EnterpriseWorker`，`asyncio.create_task(worker.run_forever())`，保存到 `app.state.enterprise_worker`；在生命周期结束处取消该任务。整个块包在 `try/except Exception` 里，失败只记日志。
- 新建 `agenticx/studio/enterprise_worker_routes.py`，`register_enterprise_worker_routes(app, check_token)`：
  - `GET /api/enterprise-worker/status` → `app.state.enterprise_worker.status()`（不存在时返回 `{"enabled": false, "running": false}`）。
  - `PUT /api/enterprise-worker` body `{"enabled": bool}` → 写 `enterprise.worker.enabled` 到 `config.yaml`（用 `ConfigManager` 现有写值方法），返回最新 status。
  - 在 `register_command_routes(app, _check_token)` 附近新增一行注册调用（若 acp-02 已在此处新增凭证路由，加在其后），import 同样只新增一行。

### Near 界面

- `desktop/src/components/AccountTab.tsx`：企业已登录时显示开关「让这台电脑承接企业智能体任务」与一行说明「开启后，房间里点名『员工桌面执行』类智能体的任务会在这台电脑上用本机模型执行」。下方显示状态：运行中/已停止、可承接的智能体名称列表、最近一次心跳时间、最近错误（若有）。未登录企业时不显示该区块。
- 数据走本机 Studio：`GET/PUT /api/enterprise-worker…`。按现有渲染进程调用本机 Studio 的方式（读 AccountTab 或 SettingsPanel 里已有的 `fetch(\`${apiBase}/api/...\`)` 或 IPC 写法并照做），开关乐观更新，失败回滚并就近提示。
- 每 10 秒刷新一次状态，组件卸载时清理定时器。

## AC

1. `tests/test_enterprise_worker.py`（`httpx.MockTransport` 同时模拟企业与本机 Studio）：
   - 未启用时 `run_once` 不发任何请求。
   - 启用后首轮发心跳；claim 返回 null 时不调用本机 `/api/chat`。
   - claim 返回任务：创建分身（mock registry）、创建会话、调用 `/api/chat`，从模拟 SSE 拼出回答并 complete，body 含 `device_id` 与 `tool_steps`。
   - SSE 出现确认请求时调用 `/api/confirm` 拒绝，`tool_steps` 记 `denied`。
   - 本机 chat 失败 → 调用 fail；企业返回 401 → 进入 60 秒暂停且 `last_error` 正确。
   - `device_id` 首次生成后再次实例化不变。
2. `tests/test_enterprise_worker_routes.py`：status 与 PUT 写配置。
3. `pytest tests/test_enterprise_worker.py tests/test_enterprise_worker_routes.py -q --no-cov` 通过；`cd desktop && npx tsc -p tsconfig.json --noEmit` 与 `npm test` 通过。
4. 冷启动：`agx serve --host 127.0.0.1 --port 18732` 后 `/api/session`、`/api/avatars`、`/api/sessions`、`/api/enterprise-worker/status` 均 200。
5. 端到端（主控执行）：本机企业已登录 → `PUT /api/enterprise-worker {"enabled": true}` → 门户房间 @ acp-06 的 `desktop-coder`「列出你当前工作目录的顶层文件名」→ 约 30 秒内房间出现该 Agent 回复，内容来自本机执行；`GET /api/enterprise-worker/status` 显示该智能体与最近心跳；关闭开关后再 @ 一次，任务保持排队、不被认领。

## Out of scope

多任务并发；纳管第三方编程 Agent 运行时；本地文件作为附件回传；企业模型代理给 Worker；Electron 主进程改动（除非 AccountTab 调用本机 Studio 必须新增 IPC，此时只加最小 IPC 并在交付说明写明）。
