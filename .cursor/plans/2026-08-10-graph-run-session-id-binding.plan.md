# Graph Run session_id 绑定修复

Planned-with: Grok 4.5
Suggested-Impl-Model: Composer 2.5

> **For implementers:** 仅凭本 plan 即可落地；勿依赖对话记忆。

**Goal:** 群聊 Presence / Workforce 运行图落盘时写入真实 studio `session_id`（UUID），前端按 pane session 拉取时可命中；并兼容历史误绑到 `group_id` / 空 `session_id` 的存量 run。

**Architecture:** `StudioSession` 无 `session_id` 字段；群聊路径已设 `_usage_owner_session_id` 但未设 `_session_id`，而 `group_router` 用 `getattr(base_session, "session_id", "")`，Presence 落空串、Workforce 回退成 `group_id`。统一用 resolver 读取 `_session_id` / `_usage_owner_session_id` / `session_id`；群聊入口补写 `_session_id`；list API 对群会话做 group 级 legacy fallback。

**Tech Stack:** Python (`group_router`, `graph/social`, `graph/store`, `studio/server`) + pytest smoke。

---

## 根因与证据链

1. `agenticx/cli/studio.py` 的 `StudioSession` **没有** `session_id` 属性。
2. `agenticx/studio/server.py` 群聊分支（约 L2928）仅：
   `setattr(session, "_usage_owner_session_id", payload.session_id)`
   非群聊路径（约 L3222）才设 `_session_id`。
3. `group_router.py`：
   - `_project_a2a_message_edge` / `_project_h2a_fanout`（约 L553 / L608）：`session_id=getattr(base_session, "session_id", "")` → 恒为空。
   - `_run_team_turn`（约 L1912）：`session_id = getattr(...) or group_id` → 绑成群 ID。
4. 本机实证（群 `98c19c731b99` / 会话 `67dfbc40-090f-48f2-b76a-d09839996ba2`）：
   - `GET /api/graph/runs?session_id=<UUID>` → `runs: []`
   - 同接口 `session_id=<group_id>` → 5 条 workforce
   - Presence `gr_pres_*` 的 `session_id == ""`

## In scope

- 解析真实 session UUID 的 helper + 三处 router 调用改写
- 群聊 chat 入口补 `setattr(session, "_session_id", payload.session_id)`
- `ensure_presence_run`：复用已有 run 时若 `session_id` 为空（或与入参不一致且入参非空）则回写
- `GraphRunStore.list_by_group_id` + `list_graph_runs`：当按 session 查空且该 session 为 `group:<gid>` 时，合并 `session_id==gid` 或 `group_id==gid` 的 legacy runs（**不**在 list 时改写磁盘，避免多会话抢占）
- 对应 pytest

## Out of scope / no-scope-creep

- 不改前端 `RunGraphPanel` / 画布布局
- 不做全量离线迁移 CLI（legacy 靠 list fallback 可见即可）
- 不改 Desktop / enterprise
- 不重构 `StudioSession` 正式加字段（沿用既有 `_session_id` 私有属性约定）
- 不改 workforce 调度 / DAG 语义

## Suggested-Impl 子任务表

| 子任务 | 推荐模型 | 理由 |
|--------|----------|------|
| Helper + social 回写 + store list_by_group | Composer 2.5 | 局部纯函数 |
| group_router / server 接线 | Composer 2.5 | 明确落点 |
| pytest | Composer 2.5 | 样板断言 |

---

## FR / AC

### FR-1: 建图写入 UUID

- **AC-1:** `resolve_studio_session_id` 优先 `_session_id`，其次 `_usage_owner_session_id`，再次 `session_id`；全空返回 `""`。
- **AC-2:** Presence / A2A / H2A / Workforce 编译均用该 resolver；Workforce **禁止**再用 `group_id` 冒充 `session_id`。
- **AC-3:** 测试：`tests/test_smoke_graph_session_id_binding.py` 用仅有 `_usage_owner_session_id` 的假 session 调用 `ensure_presence_run` 路径（或直接测 helper + compile），断言落盘 `session_id` 为 UUID 字符串而非 group id。

### FR-2: 群聊入口补 `_session_id`

- **AC-4:** `server.py` 群聊分支在 `setattr(..., "_usage_owner_session_id", ...)` 旁增加 `setattr(session, "_session_id", payload.session_id)`。

### FR-3: Presence 回写空 session_id

- **AC-5:** `ensure_presence_run` 加载 `existing_run_id` 后，若入参 `sid` 非空且 `run.session_id` 为空（或空白），则 `run.session_id = sid` 再 save。
- **AC-6:** 单测覆盖回写。

### FR-4: List legacy fallback

- **AC-7:** `GraphRunStore.list_by_group_id(gid)` 返回 `group_id==gid` **或** `session_id==gid` 的 runs。
- **AC-8:** `GET /api/graph/runs`：`list_by_session(sid)` 为空时，若 `manager.get(sid)` 的 `avatar_id` 为 `group:<gid>`，则附加 `list_by_group_id(gid)` 结果（去重 by run_id），仍不改写磁盘。
- **AC-9:** store 单测覆盖 `list_by_group_id`。

---

### Task 1: Helper + Presence 回写 + Store

**Files:**
- Create: `tests/test_smoke_graph_session_id_binding.py`
- Modify: `agenticx/runtime/group_router.py`（模块级 `resolve_studio_session_id`，靠近文件顶部 helpers）
- Modify: `agenticx/runtime/graph/social.py` — `ensure_presence_run`（约 L49–112）
- Modify: `agenticx/runtime/graph/store.py` — 新增 `list_by_group_id`

**Step 1 — 失败测试（helper / presence / store）**

```python
# tests/test_smoke_graph_session_id_binding.py
from types import SimpleNamespace
from pathlib import Path
from agenticx.runtime.group_router import resolve_studio_session_id
from agenticx.runtime.graph.social import ensure_presence_run
from agenticx.runtime.graph.store import GraphRunStore
from agenticx.runtime.graph.compiler import compile_workforce_run
from agenticx.runtime.graph.models import GraphRun, GraphNode, NodeKind, NodeStatus

def test_resolve_prefers_private_session_id():
    s = SimpleNamespace(_session_id="uuid-1", _usage_owner_session_id="uuid-2", session_id="uuid-3")
    assert resolve_studio_session_id(s) == "uuid-1"
    s2 = SimpleNamespace(_usage_owner_session_id="uuid-2")
    assert resolve_studio_session_id(s2) == "uuid-2"
    assert resolve_studio_session_id(SimpleNamespace()) == ""

def test_ensure_presence_backfills_empty_session_id(tmp_path: Path):
    store = GraphRunStore(root=tmp_path)
    run = GraphRun(
        run_id="gr_pres_x",
        session_id="",
        group_id="g1",
        nodes={},
        edges=[],
        status="open",
        version=0,
        meta={"source": "presence", "ephemeral": True},
    )
    store.save(run, bump_version=True)
    again = ensure_presence_run(
        session_id="real-uuid",
        group_id="g1",
        member_ids=["a1"],
        store=store,
        existing_run_id="gr_pres_x",
    )
    assert again.session_id == "real-uuid"
    assert store.load("gr_pres_x").session_id == "real-uuid"

def test_list_by_group_id_includes_misbound_session(tmp_path: Path):
    store = GraphRunStore(root=tmp_path)
    run = compile_workforce_run(
        session_id="g1",  # legacy misbind
        group_id="g1",
        subtasks=[SimpleNamespace(id="t1", description="A", dependencies=[])],
        assignment_map={"t1": "w1"},
        run_id="gr_legacy",
    )
    store.save(run, bump_version=True)
    found = store.list_by_group_id("g1")
    assert any(r.run_id == "gr_legacy" for r in found)
```

（`SimpleNamespace` for subtasks：与 `test_smoke_group_workforce_graph_schedule.py` 一致。）

**Step 2 — 实现**

`resolve_studio_session_id`：

```python
def resolve_studio_session_id(base_session: Any) -> str:
    for key in ("_session_id", "_usage_owner_session_id", "session_id"):
        val = str(getattr(base_session, key, "") or "").strip()
        if val:
            return val
    return ""
```

`ensure_presence_run`：在拿到 `run` 且 `sid` 非空后：

```python
if sid and not str(run.session_id or "").strip():
    run.session_id = sid
```

`GraphRunStore.list_by_group_id`：扫描 root，匹配 `run.group_id == gid or run.session_id == gid`。

**Step 3 — pytest 绿**

```bash
pytest tests/test_smoke_graph_session_id_binding.py -v
```

---

### Task 2: group_router 改绑

**Files:**
- Modify: `agenticx/runtime/group_router.py`
  - `_project_a2a_message_edge` ~L552–554
  - `_project_h2a_fanout` ~L607–609
  - `_run_team_turn` ~L1912
  - `project_id` ~L1727（可选一致性：用 resolver，勿用 `group_id` 冒充 session 段；若 `resolve` 为空再回落 `group_id` 仅用于 project_id 字符串，**不要**用于 GraphRun.session_id）

**Before（Workforce）:**

```python
session_id = str(getattr(base_session, "session_id", "") or group_id)
```

**After:**

```python
session_id = resolve_studio_session_id(base_session)
# 若为空：仍编译但 session_id=""，并 logger.warning；禁止 or group_id
```

Presence 两处：

```python
session_id=resolve_studio_session_id(base_session),
```

扩展既有 workforce smoke：`test_run_team_turn_invokes_execute_group_run` 里 session 已设 `.session_id`；另加断言 compile 收到的 session_id（若 mock 可抓）或在新文件用真实 SimpleNamespace 只测 resolve+compile 组合即可（Task1 已覆盖）。

**Verify:**

```bash
pytest tests/test_smoke_graph_session_id_binding.py tests/test_smoke_group_a2a_graph_edges.py tests/test_smoke_group_workforce_graph_schedule.py -v
```

---

### Task 3: server 入口 + list fallback

**Files:**
- Modify: `agenticx/studio/server.py`
  - 群聊分支 ~L2928：补 `_session_id`
  - `list_graph_runs` ~L6074–6102：legacy fallback

**list_graph_runs after:**

```python
runs = get_default_store().list_by_session(sid)
if not runs:
    managed = manager.get(sid, touch=False)
    avatar_id = str(getattr(managed, "avatar_id", "") or "").strip() if managed else ""
    if avatar_id.startswith("group:"):
        gid = avatar_id[len("group:"):].strip()
        if gid:
            # legacy mis-bound runs (session_id was group_id or empty+group_id set)
            seen = {r.run_id for r in runs}
            for r in get_default_store().list_by_group_id(gid):
                if r.run_id not in seen:
                    runs.append(r)
                    seen.add(r.run_id)
```

确认 `manager` 在 `create_studio_app` 闭包内对 `list_graph_runs` 可见（与其它 endpoint 一致）。

**Note:** 不改 `server.py` 顶部 import 区块无关行（AGENTS.md 敏感约束）；仅改函数体内精确行。

**Verify:** 单测 store/list；手工可选：

```bash
# 起 serve 后
curl --noproxy '*' -H "x-agx-desktop-token: $(cat ~/.agenticx/serve.token)" \
  "http://127.0.0.1:$(cat ~/.agenticx/serve.port)/api/graph/runs?session_id=67dfbc40-090f-48f2-b76a-d09839996ba2"
# 期望：legacy runs 非空（若该 session avatar_id=group:98c19c731b99）
```

---

## 验收清单

- [ ] `pytest tests/test_smoke_graph_session_id_binding.py tests/test_smoke_group_a2a_graph_edges.py tests/test_smoke_group_workforce_graph_schedule.py -q` 全绿
- [ ] 新群聊一轮后 `run.json` 的 `session_id` 为 UUID
- [ ] 旧会话 UUID list 能看到误绑到 group 的存量图（fallback）
- [ ] 未触碰 Desktop / enterprise / `server.py` import 区无关行

## Commit trailers（实施提交时）

```
Plan-Id: 2026-08-10-graph-run-session-id-binding
Plan-File: .cursor/plans/2026-08-10-graph-run-session-id-binding.plan.md
Plan-Model: Grok 4.5
Impl-Model: <实际实施模型，由用户确认>
Made-with: Damon Li
```
