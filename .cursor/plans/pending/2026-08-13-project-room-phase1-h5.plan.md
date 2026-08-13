# Project Room Phase 1（Room API + 同域 H5）Implementation Plan

> **Status: SUPERSEDED for the cloud product path.**  
> 用户已改目标为「完整云产品」。本机 `/room/` + 局域网 bind **不能**作为产品主路径（换网段/4G/关盖即不可用）。  
> 现行总规划：`.cursor/plans/pending/2026-08-13-cloud-project-room.plan.md`  
> 本文仅保留作「本机同网调试」备选，**不要按本文开工实施云产品。**

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: gpt-5.x（跨 `server.py` 接线 + SSE/会话一致性）；H5 静态页可用 Composer 2.5

**Goal:** 让已有 Desktop 群聊变成可被手机浏览器打开的「房间」：同一 `group_id` + 同一 session 的消息与运行态可看、可续聊。这是多人协作终态的同构子集（房间里暂时只有 1 个真人）。

**Architecture:** 不改 `agent_runtime` / `group_router` 内核。新增薄封装 `agenticx/studio/room_routes.py`（Room = 现有 GroupChat + `avatar_id=group:<id>` 的 session）。H5 作为静态页由 `agx serve` 同域挂在 `/room/`，避免 CORS。Desktop 可选把 serve 从 `127.0.0.1` 改绑 `0.0.0.0`，手机才能进。H5 看进度用轮询；发言走现有 `POST /api/chat`。群窗格补外部轮询，否则 H5 写入后 Desktop 看不到。

**Tech Stack:** FastAPI + 现有 SessionManager / GroupChatRegistry；vanilla HTML/JS（无新 npm workspace）；Desktop Electron `startStudioServe` host 切换。

**Parent:** `.cursor/plans/pending/2026-08-13-multi-human-agent-project-room.plan.md`

---

## In scope / Out of scope

**In scope**

- `GET /api/rooms`、`GET /api/rooms/{room_id}`（成员骨架 + 活跃 session + `execution_state`）
- 同域静态 H5：`/room/` 列表 → 进房 → 历史 → 轮询进度 → 发消息
- Desktop `studio.lan_access`：serve bind `0.0.0.0`；设置页可复制房间 URL
- 群聊 `ChatPane` 把 group pane 纳入 3s 外部轮询（对齐飞书/微信外写）
- 冒烟测试 `tests/test_smoke_room_api.py`；改 `server.py` 后冷启动 smoke

**Out of scope（禁止顺手做）**

- 第二真人 / 邀请链接 / IAM（Phase 2）
- 完整 Desktop 远程后端 plan（`.cursor/plans/2026-03-24-desktop-remote-backend.plan.md`）
- 打开全局 `runtime.live_reattach_enabled` / 新 SSE fan-out
- 原生 App、PWA 推送、微信多 Bot
- 改 `group_router.py`、`agent_runtime.py`、Enterprise portal
- 重写 `server.py` import 区或整段替换相邻路由
- 新 Vite/React 工程

---

## 根因与证据（实施者勿依赖对话）

1. 群成员只有 `avatar_ids`：`agenticx/avatar/group_chat.py` `GroupChatConfig`（约 L22–30）。
2. 群聊入口已是 `POST /api/chat` + `avatar_id=group:<id>` / `payload.group_id`：`agenticx/studio/server.py` 约 L2925–3171。
3. 历史：`GET /api/session/messages?session_id=`（约 L2034–2056）。列表：`GET /api/sessions?avatar_id=` 含 `execution_state`（约 L5560–5567 + `session_manager.list_sessions` L1178+）。
4. 第二客户端默认看不到 Desktop 正在跑的 SSE：`live_reattach_enabled()` 默认 False（`agenticx/studio/continuation.py` L49–51）。Phase 1 用轮询，不改该开关。
5. Desktop 群窗格**不会**轮询外写：`ChatPane.tsx` L3325–3338 `needsExternalPoll` 只有 IM/飞书/微信。H5 写入后 Desktop 会停在旧消息，除非把 `isGroupPane` 加进去。
6. 手机打不到 Desktop 后端：`desktop/electron/main.ts` `startStudioServe` L2767/L2773 硬编码 `--host 127.0.0.1`。CLI `agx serve` 默认已是 `0.0.0.0`（`agenticx/cli/main.py` L562），但日常用户走 Desktop spawn。
7. H5 若另开端口会撞 CORS：`_studio_cors_origins()`（`server.py` L834–861）只有 localhost Vite 端口。**同域挂 `/room/` 则不必改 CORS。**

---

## 数据契约（写死，禁止实施时发明字段名）

`room_id` **等于** `group_id`（12-hex）。不要另造 UUID。

### `GET /api/rooms`

```json
{
  "ok": true,
  "rooms": [
    {
      "room_id": "abc123def456",
      "title": "项目群名",
      "avatar_ids": ["av1"],
      "routing": "intelligent",
      "active_session_id": "sess-or-null",
      "execution_state": "idle"
    }
  ]
}
```

`active_session_id`：`session_manager.list_sessions(avatar_id="group:{room_id}")` 按 `updated_at` 降序第一条；无则 `null`。`execution_state` 取该条，无 session 则为 `"idle"`。

### `GET /api/rooms/{room_id}`

404 `{ "detail": "room not found" }` 若 `group_registry.get_group` 为 None。

```json
{
  "ok": true,
  "room": {
    "room_id": "...",
    "title": "...",
    "routing": "intelligent",
    "active_session_id": "...",
    "execution_state": "running",
    "host_label": "本机 Desktop",
    "members": [
      { "type": "human", "id": "local-operator", "display_name": "我" },
      { "type": "meta", "id": "machi", "display_name": "Machi" },
      { "type": "agent", "id": "<avatar_id>", "display_name": "<avatar.name or id>" }
    ]
  }
}
```

Phase 1 只有一个 human stub：`id=local-operator`。agent 名从 `avatar_registry.get_avatar(id)`；缺失则用 id。不要写 `human_member_ids` 进 `group.yaml`。

### 发言（H5 调现有 API，Room 模块不包装 chat）

1. 若 `active_session_id` 为空：`POST /api/sessions` body `{"avatar_id":"group:<room_id>"}`，取返回 `session_id`。
2. `POST /api/chat` JSON：

```json
{
  "session_id": "<sid>",
  "user_input": "<text>",
  "group_id": "<room_id>",
  "keep_runtime_after_disconnect": true,
  "client_turn_id": "<uuid>"
}
```

Header：`X-Agx-Desktop-Token: <token>`（与 Desktop 相同）。Accept SSE，读到 `type=done`。

3. 看进度：每 1500ms `GET /api/rooms/{id}` + `GET /api/session/messages?session_id=`。

---

## Task 1: Room API 模块 + 测试

Suggested-Impl-Model: gpt-5.x / 代码专精中档

**Files:**

- Create: `agenticx/studio/room_routes.py`
- Create: `tests/test_smoke_room_api.py`
- Modify: `agenticx/studio/server.py` **仅**在 `register_data_sources_routes(app, check_token=_check_token)` 之后（约 L1359）精确插入 3–5 行。禁止改文件顶部 import 区。禁止整段替换 `register_voice_endpoints` / `register_memory_graph_routes` 相邻块。

**Step 1: 写失败测试**

`tests/test_smoke_room_api.py` 必须覆盖：

| 测试 | 断言 |
|------|------|
| `test_list_rooms_empty` | 空 registry → `rooms == []` |
| `test_list_and_get_room_members` | 建 1 个 group + 1 avatar → list 含该 `room_id`；get 的 members 含 human/meta/agent 各至少 1；agent.id == 该 avatar |
| `test_get_room_404` | 未知 id → 404 |
| `test_room_picks_latest_group_session` | `POST /api/sessions` `avatar_id=group:{id}` 后 get/list 的 `active_session_id` 等于该 session |
| `test_rooms_require_token_when_configured` | `AGX_DESKTOP_TOKEN=secret` 无 header → 401；正确 header → 200 |
| `test_room_index_served` | `GET /room/` 或 `GET /room/index.html` → 200 且 body 含 `room`（Task 3 落地后才绿；本 task 可先 skip 或先挂最小 `index.html`） |

测试用 `tmp_path` monkeypatch `GroupChatRegistry` root 与 `AvatarRegistry` root，避免写 `~/.agenticx/groups`。模式对齐 `tests/test_smoke_group_reattach_hub.py`：`create_studio_app()` + `TestClient`。

Avatar 最小创建：走现有 `POST /api/avatars` 或直接 `AvatarRegistry(root=tmp).create_avatar(...)`（以仓库现有 test helper 为准；若无 helper，用 registry 公开 API，不要改 registry 行为）。

**Step 2: 跑测试确认失败**

```bash
cd /Users/damon/myWork/AgenticX && python -m pytest tests/test_smoke_room_api.py -v
```

Expected: FAIL（模块/路由不存在）

**Step 3: 实现 `room_routes.py`**

完整意图：

```python
#!/usr/bin/python3
"""Thin Room facade over GroupChat + group-bound sessions.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import FastAPI, Header, HTTPException
from fastapi.staticfiles import StaticFiles

ROOM_WEB_DIR = Path(__file__).resolve().parent / "room_web"
HUMAN_STUB_ID = "local-operator"
META_MEMBER = {"type": "meta", "id": "machi", "display_name": "Machi"}


def _group_avatar_id(room_id: str) -> str:
    return f"group:{room_id}"


def _latest_group_session(session_manager: Any, room_id: str) -> dict[str, Any] | None:
    rows = session_manager.list_sessions(avatar_id=_group_avatar_id(room_id)) or []
    if not rows:
        return None
    def _ts(row: dict) -> str:
        return str(row.get("updated_at") or row.get("created_at") or "")
    return sorted(rows, key=_ts, reverse=True)[0]


def _build_members(group: Any, avatar_registry: Any) -> list[dict[str, str]]:
    members = [
        {"type": "human", "id": HUMAN_STUB_ID, "display_name": "我"},
        dict(META_MEMBER),
    ]
    for aid in list(getattr(group, "avatar_ids", None) or []):
        cfg = avatar_registry.get_avatar(aid)
        name = str(getattr(cfg, "name", "") or "").strip() if cfg is not None else ""
        members.append({"type": "agent", "id": str(aid), "display_name": name or str(aid)})
    return members


def _room_payload(group: Any, *, avatar_registry: Any, session_manager: Any) -> dict[str, Any]:
    latest = _latest_group_session(session_manager, group.id)
    return {
        "room_id": group.id,
        "title": group.name,
        "avatar_ids": list(group.avatar_ids or []),
        "routing": group.routing,
        "active_session_id": (latest or {}).get("session_id"),
        "execution_state": str((latest or {}).get("execution_state") or "idle"),
        "host_label": "本机 Desktop",
        "members": _build_members(group, avatar_registry),
    }


def register_room_routes(
    app: FastAPI,
    *,
    check_token: Callable[[Optional[str]], None],
    group_registry: Any,
    avatar_registry: Any,
    session_manager: Any,
) -> None:
    if getattr(app.state, "_room_routes_registered", False):
        return
    app.state._room_routes_registered = True

    @app.get("/api/rooms")
    async def list_rooms(
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        check_token(x_agx_desktop_token)
        rooms = []
        for g in group_registry.list_groups():
            payload = _room_payload(g, avatar_registry=avatar_registry, session_manager=session_manager)
            rooms.append({k: payload[k] for k in (
                "room_id", "title", "avatar_ids", "routing", "active_session_id", "execution_state"
            )})
        return {"ok": True, "rooms": rooms}

    @app.get("/api/rooms/{room_id}")
    async def get_room(
        room_id: str,
        x_agx_desktop_token: str | None = Header(default=None),
    ) -> dict:
        check_token(x_agx_desktop_token)
        group = group_registry.get_group(room_id)
        if group is None:
            raise HTTPException(status_code=404, detail="room not found")
        return {
            "ok": True,
            "room": _room_payload(group, avatar_registry=avatar_registry, session_manager=session_manager),
        }

    if ROOM_WEB_DIR.is_dir():
        app.mount("/room", StaticFiles(directory=str(ROOM_WEB_DIR), html=True), name="room_web")
```

**server.py 插入（唯一允许的改动点，约 L1357–1360 之后）：**

```python
    from agenticx.studio.room_routes import register_room_routes

    register_room_routes(
        app,
        check_token=_check_token,
        group_registry=group_registry,
        avatar_registry=avatar_registry,
        session_manager=manager,
    )
```

这是函数体内 local import，**不要**加到文件顶部 import 区块。对照 diff：除这几行外 `server.py` 零其它增删。

**Step 4: 跑测试**

```bash
python -m pytest tests/test_smoke_room_api.py -v
```

Expected: PASS（`test_room_index_served` 若还无 `room_web/`，本 task 先放一个最小 `agenticx/studio/room_web/index.html`：`<!doctype html><title>Room</title><p>room</p>`，避免 Task 3 才绿。）

**Step 5: server.py 冷启动 smoke（改了 server.py 则强制）**

```bash
agx serve --host 127.0.0.1 --port 8765 --token test-room-1
# 另开终端：
curl -s -H 'X-Agx-Desktop-Token: test-room-1' http://127.0.0.1:8765/api/session
curl -s -H 'X-Agx-Desktop-Token: test-room-1' http://127.0.0.1:8765/api/avatars
curl -s -H 'X-Agx-Desktop-Token: test-room-1' http://127.0.0.1:8765/api/sessions
curl -s -H 'X-Agx-Desktop-Token: test-room-1' http://127.0.0.1:8765/api/rooms
curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/room/
# 全部 200 后杀掉 serve
```

Expected: 进程不崩溃；上列 200。

---

## Task 2: Desktop 群窗格轮询外写（否则 AC-2 必挂）

Suggested-Impl-Model: Composer 2.5

**Files:**

- Modify: `desktop/src/components/ChatPane.tsx` L3325–3338

**Before:**

```ts
      const needsExternalPoll = isImSession || isFeishuBound || isWechatBound;
```

**After:**

```ts
      const needsExternalPoll =
        isImSession || isFeishuBound || isWechatBound || isGroupPane;
```

`isGroupPane` 已在同组件约 L2651 定义。不要改 poll 间隔、不要改飞书/微信分支、不要把 Meta 单聊也纳入。

无现成单测文件；本改动靠 AC-2 手测。不要为测这一行去抽 hook（no-scope-creep）。

---

## Task 3: 同域 H5

Suggested-Impl-Model: Composer 2.5

**Files:**

- Create: `agenticx/studio/room_web/index.html`
- Create: `agenticx/studio/room_web/app.js`
- Create: `agenticx/studio/room_web/styles.css`

单页即可（hash 路由）：`#token=` 存 token（hash 不进服务端 access log）；`#room/<id>` 进房。

**UI 最低集（中文）：**

1. 无 token：输入框「粘贴 Desktop Token」+ 进入。token 来自 `~/.agenticx/serve.token`。写入 `sessionStorage.agxRoomToken`。
2. 房间列表：标题 + `execution_state`（空闲/生成中）。点进房。
3. 房间：成员芯片（我 / Machi / 分身名）；消息列表（`role` + `content` 纯文本即可，不要重做 Desktop Markdown）；底部输入；「生成中」条根据 `execution_state === "running"`。
4. 页脚固定文案：`执行宿主：本机 Desktop（手机只旁观/发消息）`
5. 请求失败 401：清 token 回登录。网络失败：页面内黄条「连不上后端，确认电脑与手机同一局域网，且已开启局域网访问」，不要只 `console.error`。

**`app.js` 约束：**

- `api(path, opts)`：`headers['X-Agx-Desktop-Token']`；`credentials` 不要 include（CORS `allow_credentials=False`）。
- 列表/房间 `setInterval` 1500ms，`visibilitychange` 隐藏时 pause。
- 发送：见上文契约；`user_input` trim 空则 return；发送中 disable 按钮。
- 不要引入 React/Vue/构建器。

暗色背景、可读对比即可，不要做品牌重塑。

**验证：**

```bash
python -m pytest tests/test_smoke_room_api.py::test_room_index_served -v
curl -s http://127.0.0.1:8765/room/ | head
```

Expected: HTML 含登录或房间字样。

---

## Task 4: Desktop 局域网 bind + 复制链接

Suggested-Impl-Model: gpt-5.x（碰 `main.ts` spawn；改完必须完全重启 Electron，刷新渲染进程无效）

**Files:**

- Modify: `desktop/electron/main.ts`
  - `AgxConfig` 类型（约 L253）：新增可选 `studio?: { lan_access?: boolean }`
  - `startStudioServe`（约 L2724–2776）：host 变量替换两处硬编码 `"127.0.0.1"`
  - 新增 IPC `get-room-web-link`
- Modify: `desktop/electron/preload.ts`：暴露该 IPC
- Modify: `desktop/src/global.d.ts`：类型
- Modify: `desktop/src/components/SettingsPanel.tsx`：Automation（或 Runtime）加一块「房间网页」，不要新 Tab，不要放进 Skills

**Bind 逻辑（写死）：**

```ts
const lanAccess = Boolean(cfg?.studio?.lan_access);
const serveHost = lanAccess ? "0.0.0.0" : "127.0.0.1";
// spawnBundledServer / spawnAgx 的 ["--host", serveHost, "--port", String(apiPort)]
```

`get-api-base` **必须仍返回** `http://127.0.0.1:${port}`（本机渲染进程走 loopback，避免误走局域网 IP / 代理坑）。只把对外 URL 放在 `get-room-web-link`。

**`get-room-web-link` 返回：**

```ts
{
  ok: true,
  lanAccess: boolean,
  loopbackUrl: `http://127.0.0.1:${apiPort}/room/`,
  lanUrl: lanAccess ? `http://<ipv4>:${apiPort}/room/` : "",
  token: apiToken,  // preload 可返回；Settings 复制时拼 `#token=`；日志禁止打印 token
}
```

IPv4 选取：`os.networkInterfaces()` 中第一个非 internal 的 IPv4（跳过 `169.254.*`）。找不到则 `lanUrl=""` 且 Settings 提示「未检测到局域网 IP」。

**Settings UI：**

- 开关「允许局域网访问房间页」↔ `studio.lan_access`，保存进 `~/.agenticx/config.yaml`（走现有 save-config，不要新文件）。
- 文案：开启后需**完全退出并重开** Desktop 才生效。
- 按钮「复制房间链接」：`lanAccess` 时复制 `lanUrl + '#token=' + token`，否则复制 loopback URL；toast「已复制」。
- 不要把 token 明文常驻显示；复制时带上即可。

**config.yaml 示例（用户侧，不要把真实 token 写进仓库）：**

```yaml
studio:
  lan_access: true
```

---

## Task 5: 联调验收（手测清单，实施者必须跑）

Suggested-Impl-Model: 实施者本机

**AC-1 同机旁观：** Desktop 打开某群并让 Agent 生成中 → 本机浏览器 `http://127.0.0.1:<serve.port>/room/#token=...` 进同一房间 → ≤3s 内看到新消息或「生成中」。

**AC-2 手机续聊：** `lan_access: true` 重启 Desktop → 手机同一 Wi-Fi 打开复制的链接 → 发一句 → Desktop 群窗格 3s 内出现该用户消息且 Agent 继续答。

**AC-3 刷新：** H5 刷新后历史仍在（来自 `messages.json`，不是仅内存）。

**AC-4 回归：** `python -m pytest tests/test_smoke_room_api.py tests/test_smoke_group_legacy_routing.py tests/test_smoke_group_reattach_hub.py -q` 绿；`server.py` 冷启动 curl 仍 200。

**AC-5 未开局域网：** `lan_access` 默认 false；手机打 `127.0.0.1` 失败；H5 黄条可见（本机浏览器仍可用 loopback）。

失败时先查：防火墙、是否重启了 Electron、token 是否与 `~/.agenticx/serve.token` 一致、群 session 的 `avatar_id` 是否为 `group:<id>`。

---

## 子任务 → 推荐模型

| 任务 | Suggested-Impl-Model | 理由 |
|------|----------------------|------|
| Task 1 Room API + server.py 三行 | gpt-5.x | `server.py` 误伤会让 Desktop 全空 |
| Task 2 ChatPane 一行 | Composer 2.5 | 单行、有锚点 |
| Task 3 H5 | Composer 2.5 | 静态页样板 |
| Task 4 lan_access + IPC | gpt-5.x | Electron 主进程不热更新，bind 回归中 |
| Task 5 联调 | 实施者 | |

---

## 风险

| 风险 | 处理 |
|------|------|
| `app.mount("/room")` 抢路由 | 只挂 `/room`，API 全在 `/api/` |
| Windows 防火墙拦 0.0.0.0 | Settings 注明可能需允许入站；失败走黄条 |
| Token 进剪贴板 | LAN MVP 可接受；禁止 commit token；日志不打印 |
| 群正在 `running` 时 H5 再 POST `/api/chat` | 现有 409 / 排队语义保持；H5 生成中 disable 发送 |
| StaticFiles 在 TestClient 下 404 | `html=True` + 测 `/room/` 与 `/room/index.html` 都试 |

---

## Commit 边界（实施时用户再要求才 commit）

只 add：`room_routes.py`、`room_web/*`、`tests/test_smoke_room_api.py`、`server.py` 那几行、`ChatPane.tsx` 一行、`main.ts`/`preload.ts`/`global.d.ts`/`SettingsPanel.tsx` 局域网相关。不要夹带无关 dirty 文件。

Trailers 在用户要求 commit 时再问 `Impl-Model`；本 plan id：`2026-08-13-project-room-phase1-h5`。
