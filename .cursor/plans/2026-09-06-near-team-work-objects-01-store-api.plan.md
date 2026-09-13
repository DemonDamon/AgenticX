# 子计划 01：事项存储与 Studio REST

Planned-with: Cursor Grok 4.6
Suggested-Impl-Model: Cursor Grok 4.6
Parent-Plan: `.cursor/plans/2026-09-06-near-ai-native-team-work-objects.plan.md`
Plan-Id: 2026-09-06-near-team-work-objects-01-store-api

> **For implementer:** 只改本文件列出的路径。先写测试再写实现。触碰 `agenticx/studio/server.py` 时只能在指定锚点**精确插入**新 handler，禁止替换文件顶部 import 区或改动相邻的 `post_group_action` / `delete_group` 函数体。改完 `server.py` 必须按文末做一次冷启动 smoke。不要 commit，除非用户明确要求。不要实施 02/03。

**Goal:** 每个群有一份可持久化的事项清单；Studio 提供 list/create/patch 与人专用 accept/pause/resume；并发用 `expected_version` 返回 409。

**Architecture:** 新建 `agenticx/runtime/work_items.py` 作为唯一读写入口。路径复用 `agenticx.avatar.group_chat._groups_root()`，文件为 `~/.agenticx/groups/<gid>/work_items.json`。REST 挂在现有 `/api/groups` 旁边，沿用 `_check_token`。

**Tech Stack:** Python 3.10、dataclass、json 文件、FastAPI、pytest、`fastapi.testclient.TestClient`。

---

## In scope

- `WorkItem` / `WorkItemStore` / 状态机 / 版本冲突
- `GET/POST /api/groups/{group_id}/work-items`
- `PATCH /api/groups/{group_id}/work-items/{item_id}`
- `POST .../accept` `POST .../pause` `POST .../resume`
- 群不存在 → 404；非法迁移 → 400；版本冲突 → 409

## Out of scope

- `group_router.py`、Meta 工具、Desktop UI
- 改 `group.yaml` schema、改 `GroupChatConfig`
- 改 TaskLock / Graph / Workforce
- 改 `server.py` 顶部 import
- 多真人鉴权、OKR、房间拓扑
- 自动从聊天创建事项

---

## 现状锚点（实施者自行打开核对）

- 群目录：`agenticx/avatar/group_chat.py` · `_groups_root()`（约 L18–24）、`GroupChatRegistry.get_group`（约 L103–104）
- Token：`agenticx/studio/server.py` 内已有 `_check_token`；`create_group` 约 L6240；`post_group_action` 约 L6500；`delete_group` 约 L6526
- 测试样例：`tests/test_smoke_group_reattach_hub.py` 用 `create_studio_app()` + `TestClient`（约 L148）

---

## FR-1：WorkItemStore 读写与状态机

**Files:**

- Create: `agenticx/runtime/work_items.py`
- Test: `tests/test_work_item_store.py`

### Step 1: 先写失败测试

`tests/test_work_item_store.py` 必须包含下列用例（函数名不得改，方便验收）：

```python
def test_create_and_list_isolated_by_group(tmp_path, monkeypatch): ...
def test_illegal_transition_rejected(): ...
def test_expected_version_conflict(): ...
def test_accept_only_from_human_action(): ...
def test_pause_and_resume_restore_prior_status(): ...
def test_blocked_by_not_ready_until_accepted(): ...
```

用 `monkeypatch` 把 `agenticx.avatar.group_chat._groups_root`（或 store 内部调用的同一函数）指到 `tmp_path / "groups"`。不要写开发者真实 `~/.agenticx`。

### Step 2: 实现 `agenticx/runtime/work_items.py`

按下面**原样实现**，不要改字段名、不要加额外状态。

```python
"""Group-scoped work items (org objects). Not session todos.

Author: Damon Li
"""

from __future__ import annotations

import json
import threading
import uuid
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Literal

STATUSES = ("open", "in_progress", "submitted", "accepted", "paused", "cancelled")
OWNER_KINDS = ("human", "avatar", "meta")
META_OWNER_ID = "__meta__"
HUMAN_OWNER_ID = ""

_TRANSITIONS: dict[str, set[str]] = {
    "open": {"in_progress", "paused", "cancelled"},
    "in_progress": {"submitted", "paused", "cancelled"},
    "submitted": {"accepted", "in_progress", "paused", "cancelled"},
    "paused": {"open", "in_progress", "cancelled"},
    "accepted": set(),
    "cancelled": set(),
}

_FILE_LOCKS: dict[str, threading.Lock] = {}
_FILE_LOCKS_GUARD = threading.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _new_id() -> str:
    return "wi_" + uuid.uuid4().hex[:12]


def _groups_root() -> Path:
    from agenticx.avatar.group_chat import _groups_root as _root

    return _root()


def work_items_path(group_id: str) -> Path:
    gid = str(group_id or "").strip()
    if not gid:
        raise ValueError("group_id required")
    return _groups_root() / gid / "work_items.json"


def _lock_for(group_id: str) -> threading.Lock:
    with _FILE_LOCKS_GUARD:
        lock = _FILE_LOCKS.get(group_id)
        if lock is None:
            lock = threading.Lock()
            _FILE_LOCKS[group_id] = lock
        return lock


@dataclass
class WorkItem:
    id: str
    group_id: str
    title: str
    status: str = "open"
    owner_kind: str = "human"
    owner_id: str = HUMAN_OWNER_ID
    reviewer_kind: str = "human"
    definition_of_done: str = ""
    artifact_paths: list[str] = field(default_factory=list)
    blocked_by: list[str] = field(default_factory=list)
    source_session_id: str = ""
    source_preview: str = ""
    resume_status: str = "open"
    version: int = 1
    created_at: str = ""
    updated_at: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> "WorkItem":
        known = set(cls.__dataclass_fields__)
        data = {k: v for k, v in raw.items() if k in known}
        item = cls(**data)
        if item.status not in STATUSES:
            item.status = "open"
        if item.owner_kind not in OWNER_KINDS:
            item.owner_kind = "human"
        item.reviewer_kind = "human"
        item.artifact_paths = [str(x) for x in (item.artifact_paths or []) if str(x).strip()]
        item.blocked_by = [str(x) for x in (item.blocked_by or []) if str(x).strip()]
        return item


class WorkItemError(Exception):
    def __init__(self, message: str, *, status_code: int = 400) -> None:
        super().__init__(message)
        self.status_code = status_code


class WorkItemStore:
    def _load_doc(self, group_id: str) -> dict[str, Any]:
        path = work_items_path(group_id)
        if not path.exists():
            return {"doc_version": 1, "items": []}
        raw = json.loads(path.read_text(encoding="utf-8") or "{}")
        if not isinstance(raw, dict):
            return {"doc_version": 1, "items": []}
        items = raw.get("items")
        if not isinstance(items, list):
            items = []
        return {"doc_version": int(raw.get("doc_version") or 1), "items": items}

    def _save_doc(self, group_id: str, doc: dict[str, Any]) -> None:
        path = work_items_path(group_id)
        path.parent.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
        tmp.replace(path)

    def list_items(self, group_id: str) -> list[WorkItem]:
        gid = str(group_id or "").strip()
        with _lock_for(gid):
            doc = self._load_doc(gid)
        return [WorkItem.from_dict(x) for x in doc["items"] if isinstance(x, dict)]

    def get_item(self, group_id: str, item_id: str) -> WorkItem | None:
        target = str(item_id or "").strip()
        for item in self.list_items(group_id):
            if item.id == target:
                return item
        return None

    def create_item(
        self,
        group_id: str,
        *,
        title: str,
        owner_kind: str = "human",
        owner_id: str = HUMAN_OWNER_ID,
        definition_of_done: str = "",
        blocked_by: list[str] | None = None,
        source_session_id: str = "",
        source_preview: str = "",
        allowed_owner_ids: set[str] | None = None,
    ) -> WorkItem:
        gid = str(group_id or "").strip()
        title_s = str(title or "").strip()
        if not title_s:
            raise WorkItemError("title required", status_code=400)
        kind = str(owner_kind or "human").strip()
        if kind not in OWNER_KINDS:
            raise WorkItemError("invalid owner_kind", status_code=400)
        oid = HUMAN_OWNER_ID if kind == "human" else str(owner_id or "").strip()
        if kind == "meta":
            oid = META_OWNER_ID
        if kind == "avatar":
            if not oid:
                raise WorkItemError("owner_id required for avatar", status_code=400)
            if allowed_owner_ids is not None and oid not in allowed_owner_ids:
                raise WorkItemError("owner_id is not a group member", status_code=400)
        now = _utc_now()
        item = WorkItem(
            id=_new_id(),
            group_id=gid,
            title=title_s[:200],
            owner_kind=kind,
            owner_id=oid,
            definition_of_done=str(definition_of_done or "").strip()[:2000],
            blocked_by=[str(x).strip() for x in (blocked_by or []) if str(x).strip()],
            source_session_id=str(source_session_id or "").strip(),
            source_preview=str(source_preview or "").strip()[:120],
            created_at=now,
            updated_at=now,
        )
        with _lock_for(gid):
            doc = self._load_doc(gid)
            doc["items"].append(item.to_dict())
            self._save_doc(gid, doc)
        return item

    def _mutate(
        self,
        group_id: str,
        item_id: str,
        *,
        expected_version: int,
        mutator,
    ) -> WorkItem:
        gid = str(group_id or "").strip()
        iid = str(item_id or "").strip()
        with _lock_for(gid):
            doc = self._load_doc(gid)
            found = None
            idx = -1
            for i, raw in enumerate(doc["items"]):
                if isinstance(raw, dict) and str(raw.get("id") or "") == iid:
                    found = WorkItem.from_dict(raw)
                    idx = i
                    break
            if found is None:
                raise WorkItemError("work item not found", status_code=404)
            if int(found.version) != int(expected_version):
                raise WorkItemError("version conflict", status_code=409)
            mutator(found)
            found.version = int(found.version) + 1
            found.updated_at = _utc_now()
            doc["items"][idx] = found.to_dict()
            self._save_doc(gid, doc)
            return found

    def patch_item(
        self,
        group_id: str,
        item_id: str,
        *,
        expected_version: int,
        title: str | None = None,
        definition_of_done: str | None = None,
        artifact_paths: list[str] | None = None,
        blocked_by: list[str] | None = None,
        status: str | None = None,
        allow_status: bool = False,
        allowed_owner_ids: set[str] | None = None,
        owner_kind: str | None = None,
        owner_id: str | None = None,
    ) -> WorkItem:
        def mutator(item: WorkItem) -> None:
            if title is not None:
                t = str(title).strip()
                if not t:
                    raise WorkItemError("title cannot be empty", status_code=400)
                item.title = t[:200]
            if definition_of_done is not None:
                item.definition_of_done = str(definition_of_done).strip()[:2000]
            if artifact_paths is not None:
                item.artifact_paths = [str(x).strip() for x in artifact_paths if str(x).strip()]
            if blocked_by is not None:
                item.blocked_by = [str(x).strip() for x in blocked_by if str(x).strip()]
            if owner_kind is not None or owner_id is not None:
                kind = str(owner_kind or item.owner_kind).strip()
                if kind not in OWNER_KINDS:
                    raise WorkItemError("invalid owner_kind", status_code=400)
                oid = item.owner_id
                if owner_id is not None:
                    oid = str(owner_id).strip()
                if kind == "human":
                    oid = HUMAN_OWNER_ID
                if kind == "meta":
                    oid = META_OWNER_ID
                if kind == "avatar" and allowed_owner_ids is not None and oid not in allowed_owner_ids:
                    raise WorkItemError("owner_id is not a group member", status_code=400)
                item.owner_kind = kind
                item.owner_id = oid
            if status is not None:
                if not allow_status:
                    raise WorkItemError("status can only change via accept/pause/resume/submit helpers", status_code=400)
                self._apply_status(item, status)

        return self._mutate(group_id, item_id, expected_version=expected_version, mutator=mutator)

    @staticmethod
    def _apply_status(item: WorkItem, new_status: str) -> None:
        dest = str(new_status or "").strip()
        if dest not in STATUSES:
            raise WorkItemError("invalid status", status_code=400)
        if dest == item.status:
            return
        allowed = _TRANSITIONS.get(item.status, set())
        if dest not in allowed:
            raise WorkItemError(
                f"illegal transition {item.status} -> {dest}",
                status_code=400,
            )
        if dest == "paused":
            item.resume_status = item.status if item.status != "paused" else item.resume_status
        item.status = dest

    def submit(self, group_id: str, item_id: str, *, expected_version: int, artifact_paths: list[str] | None = None) -> WorkItem:
        def mutator(item: WorkItem) -> None:
            if artifact_paths is not None:
                item.artifact_paths = [str(x).strip() for x in artifact_paths if str(x).strip()]
            self._apply_status(item, "submitted")

        return self._mutate(group_id, item_id, expected_version=expected_version, mutator=mutator)

    def mark_in_progress(self, group_id: str, item_id: str, *, expected_version: int) -> WorkItem:
        def mutator(item: WorkItem) -> None:
            self._apply_status(item, "in_progress")

        return self._mutate(group_id, item_id, expected_version=expected_version, mutator=mutator)

    def accept(self, group_id: str, item_id: str, *, expected_version: int) -> WorkItem:
        """Human-only transition to accepted. Callers must be REST accept, not meta tools."""
        def mutator(item: WorkItem) -> None:
            self._apply_status(item, "accepted")

        return self._mutate(group_id, item_id, expected_version=expected_version, mutator=mutator)

    def pause(self, group_id: str, item_id: str, *, expected_version: int) -> WorkItem:
        def mutator(item: WorkItem) -> None:
            self._apply_status(item, "paused")

        return self._mutate(group_id, item_id, expected_version=expected_version, mutator=mutator)

    def resume(self, group_id: str, item_id: str, *, expected_version: int) -> WorkItem:
        def mutator(item: WorkItem) -> None:
            dest = item.resume_status if item.resume_status in {"open", "in_progress", "submitted"} else "open"
            if dest == "submitted":
                dest = "in_progress"
            self._apply_status(item, dest)

        return self._mutate(group_id, item_id, expected_version=expected_version, mutator=mutator)

    def cancel(self, group_id: str, item_id: str, *, expected_version: int) -> WorkItem:
        def mutator(item: WorkItem) -> None:
            self._apply_status(item, "cancelled")

        return self._mutate(group_id, item_id, expected_version=expected_version, mutator=mutator)

    def blockers_accepted(self, group_id: str, item: WorkItem) -> bool:
        if not item.blocked_by:
            return True
        by_id = {x.id: x for x in self.list_items(group_id)}
        for bid in item.blocked_by:
            other = by_id.get(bid)
            if other is None or other.status != "accepted":
                return False
        return True

    def owner_has_pause(self, group_id: str, owner_id: str) -> bool:
        oid = str(owner_id or "").strip()
        return any(i.owner_id == oid and i.status == "paused" for i in self.list_items(group_id))

    def dispatch_blocked_reason(self, group_id: str, owner_id: str) -> str:
        """Empty string means auto-dispatch is allowed for this owner."""
        oid = str(owner_id or "").strip()
        if self.owner_has_pause(group_id, oid):
            return "owner_paused"
        owned = [
            i
            for i in self.list_items(group_id)
            if i.owner_id == oid and i.status in {"open", "in_progress"}
        ]
        for item in owned:
            if not self.blockers_accepted(group_id, item):
                return "blocked_by_unaccepted"
        return ""


_STORE: WorkItemStore | None = None


def get_work_item_store() -> WorkItemStore:
    global _STORE
    if _STORE is None:
        _STORE = WorkItemStore()
    return _STORE
```

`test_accept_only_from_human_action`：断言 `WorkItemStore.accept` 存在且能从 `submitted` 走到 `accepted`；并断言 **本模块没有** 给非 REST 用的「auto_accept」。不要在 store 里加 `actor=` 参数——人专用由 02 的工具表 + 01 的独立 REST 路径保证。

`test_illegal_transition_rejected`：`accepted → open` 必须 `WorkItemError.status_code == 400`。

`test_expected_version_conflict`：同一 item `expected_version=1` 成功后再用 `1` patch，必须 409。

### Step 3: 跑测试

```bash
cd /Users/damon/myWork/AgenticX
python -m pytest tests/test_work_item_store.py -q
```

Expected: PASS，且不创建真实 `~/.agenticx/groups` 垃圾数据。

---

## FR-2：Studio REST

**Files:**

- Modify: `agenticx/studio/server.py` —— **仅**在 `post_group_action` 函数结束（`return {"ok": True, "action": action_str}`）之后、`delete_group` 的 `@app.delete("/api/groups/{group_id}")` **之前**插入下列 handler。
- Test: `tests/test_work_item_api.py`

### Before（锚点，不要改这两函数）

```6500:6535:agenticx/studio/server.py
    @app.post("/api/groups/{group_id}/action")
    async def post_group_action(...):
        ...
        return {"ok": True, "action": action_str}

    @app.delete("/api/groups/{group_id}")
    async def delete_group(...):
```

### After 意图

在两函数之间插入 5 个 endpoint。每个 handler **函数体内** `from agenticx.runtime.work_items import WorkItemError, get_work_item_store`（禁止改文件顶部 import 块）。

伪代码（必须遵守行为，变量名可微调）：

```python
    def _require_group(group_id: str):
        cfg = group_registry.get_group(group_id)
        if cfg is None:
            raise HTTPException(status_code=404, detail="group not found")
        return cfg

    def _work_item_http(exc: Exception):
        if isinstance(exc, WorkItemError):
            raise HTTPException(status_code=exc.status_code, detail=str(exc)) from exc
        raise

    @app.get("/api/groups/{group_id}/work-items")
    async def list_work_items(group_id: str, x_agx_desktop_token: str | None = Header(default=None)) -> dict:
        _check_token(x_agx_desktop_token)
        _require_group(group_id)
        items = get_work_item_store().list_items(group_id)
        return {"ok": True, "items": [i.to_dict() for i in items]}

    @app.post("/api/groups/{group_id}/work-items")
    async def create_work_item(group_id: str, payload: dict, x_agx_desktop_token: str | None = Header(default=None)) -> dict:
        _check_token(x_agx_desktop_token)
        cfg = _require_group(group_id)
        allowed = set(cfg.avatar_ids)
        try:
            item = get_work_item_store().create_item(
                group_id,
                title=str(payload.get("title") or ""),
                owner_kind=str(payload.get("owner_kind") or "human"),
                owner_id=str(payload.get("owner_id") or ""),
                definition_of_done=str(payload.get("definition_of_done") or ""),
                blocked_by=list(payload.get("blocked_by") or []),
                source_session_id=str(payload.get("source_session_id") or ""),
                source_preview=str(payload.get("source_preview") or ""),
                allowed_owner_ids=allowed,
            )
        except Exception as exc:
            _work_item_http(exc)
        return {"ok": True, "item": item.to_dict()}

    @app.patch("/api/groups/{group_id}/work-items/{item_id}")
    async def patch_work_item(...):
        # payload.expected_version 必填 int，否则 400
        # 允许 title / definition_of_done / artifact_paths / blocked_by / owner_kind / owner_id
        # 禁止通过 PATCH 改 status（payload 含 status 则 400）
        # store.patch_item(..., allow_status=False)

    @app.post("/api/groups/{group_id}/work-items/{item_id}/accept")
    async def accept_work_item(...):
        # expected_version from JSON body
        # store.accept

    @app.post("/api/groups/{group_id}/work-items/{item_id}/pause")
    async def pause_work_item(...):
        # store.pause

    @app.post("/api/groups/{group_id}/work-items/{item_id}/resume")
    async def resume_work_item(...):
        # store.resume
```

`expected_version` 从 JSON body 读取：`payload.get("expected_version")`，无法转 `int` 则 400。

### API 测试

`tests/test_work_item_api.py`：

1. `monkeypatch` HOME / `agx_home` 到 tmp（对照 `tests/test_smoke_group_reattach_hub.py` 的隔离方式；若该文件用真实 registry，则先 `POST /api/groups` 建一个测试群，成员用已有 `POST /api/avatars` 或 registry 里测试夹具）。
2. **最小可行路径：** 若拉起完整 `create_studio_app()` 过重，允许只测 store + 一个本地 FastAPI 小 app 挂同样 6 个路由函数。但 **优先** 走 `create_studio_app()`，这样 03 的 Desktop 才能打到真路由。
3. 必过用例：
   - 未知 `group_id` → 404
   - create + list 看到 1 条
   - avatar owner 不在 `avatar_ids` → 400
   - PATCH 带旧 `expected_version` → 409
   - PATCH `{"status":"accepted"}` → 400
   - create 后 `in_progress`（可在测试里直接调 store.mark_in_progress）再 POST submit（**01 可以暂不暴露 submit REST**；submit 由 02 的 store.submit / Meta 工具调用。本计划 REST **不要**加 `/submit`，避免 03 误把提交做成按钮抢人的验收。）
   - 将 item 调到 `submitted` 后 POST accept → `accepted`
   - POST pause → `paused`；POST resume → 回到 pause 前

若测试里需要 `submitted`，直接 `get_work_item_store().mark_in_progress` + `submit`，不要为此新增 REST。

### Step 4: 跑测试

```bash
python -m pytest tests/test_work_item_store.py tests/test_work_item_api.py -q
```

Expected: PASS。

---

## FR-3：server.py 冷启动 smoke（改了 server.py 就必须做）

```bash
# 选一个空闲端口，例如 18765
agx serve --host 127.0.0.1 --port 18765
# 另开终端（localhost 绕代理）：
curl --noproxy '*' -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18765/api/session
curl --noproxy '*' -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18765/api/avatars
curl --noproxy '*' -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18765/api/sessions
```

Expected: 进程不崩溃；上述 API 为 200 或既有鉴权码（401），**绝不能** 500 / NameError。然后停掉该进程。

---

## AC 汇总

| ID | 断言 |
|---|---|
| AC-1 | `work_items.json` 位于 `_groups_root()/<gid>/`，与 `group.yaml` 并列 |
| AC-2 | 跨 group_id 列表互不可见 |
| AC-3 | 非法状态迁移 400；版本冲突 409 |
| AC-4 | REST 不能 PATCH status；accept/pause/resume 是独立 POST |
| AC-5 | 未知群 404 |
| AC-6 | `server.py` import 区无无关增删；`post_group_action` / `delete_group` 行为不变 |
| AC-7 | 冷启动不崩溃 |

---

## 实施完成定义

- 上述 pytest 全绿
- smoke 做过
- git diff **只含** `agenticx/runtime/work_items.py`、`tests/test_work_item_store.py`、`tests/test_work_item_api.py`、`agenticx/studio/server.py` 中新插入的 handler
- 未改 Desktop、未改 `group_router.py`
