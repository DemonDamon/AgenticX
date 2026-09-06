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
from typing import Any

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
                    raise WorkItemError(
                        "status can only change via accept/pause/resume/submit helpers",
                        status_code=400,
                    )
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

    def submit(
        self,
        group_id: str,
        item_id: str,
        *,
        expected_version: int,
        artifact_paths: list[str] | None = None,
    ) -> WorkItem:
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


def build_work_items_prompt_block(group_id: str) -> str:
    gid = str(group_id or "").strip()
    if not gid:
        return ""
    items = get_work_item_store().list_items(gid)
    active = [i for i in items if i.status not in {"cancelled"}]
    if not active:
        return ""
    lines = ["## 本群事项（组织后台，不是聊天记录）"]
    lines.append("- 长产物写群共享工作区；群里只回结论。")
    lines.append("- 你不能把事项标为 accepted；验收是用户的按钮。")
    store = get_work_item_store()
    for item in active:
        owner = item.owner_id or "用户"
        ready = store.blockers_accepted(gid, item)
        block = "" if ready else "；前置未验收"
        lines.append(
            f"- [{item.status}] {item.id} {item.title} · 负责人={owner}{block}"
        )
    return "\n".join(lines) + "\n"
