"""File-backed ObjectStore for UModel v0.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Protocol

from agenticx.ops.query import QueryScope, clamp_limit, scope_is_invalid
from agenticx.ops.umodel.schema import OBJECT_KINDS, UModelObject, prepare_object


class ObjectStore(Protocol):
    def upsert(self, obj: UModelObject) -> UModelObject: ...

    def get(
        self, kind: str, object_id: str, *, tenant_id: str = ""
    ) -> UModelObject | None: ...

    def list(self, scope: QueryScope, *, kind: str = "") -> list[UModelObject]: ...


def default_umodel_path() -> Path:
    raw = os.environ.get("AGENTICX_UMODEL_PATH", "").strip()
    if raw:
        return Path(raw)
    return Path.home() / ".agenticx" / "ops" / "umodel.json"


def get_object_store() -> FileObjectStore:
    return FileObjectStore(default_umodel_path())


def _parse_ts(raw: object) -> datetime | None:
    if raw is None or raw == "":
        return None
    text = str(raw).strip()
    if not text:
        return None
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None


def _object_to_dict(obj: UModelObject) -> dict[str, object]:
    ts = obj.updated_ts.isoformat() if isinstance(obj.updated_ts, datetime) else ""
    return {
        "kind": obj.kind,
        "id": obj.id,
        "tenant_id": obj.tenant_id,
        "session_id": obj.session_id,
        "deployment_id": obj.deployment_id,
        "trace_id": obj.trace_id,
        "tool_call_id": obj.tool_call_id,
        "name": obj.name,
        "status": obj.status,
        "summary": obj.summary,
        "attrs": dict(obj.attrs),
        "updated_ts": ts,
    }


def _object_from_dict(raw: dict) -> UModelObject | None:
    try:
        return prepare_object(
            UModelObject(
                kind=str(raw.get("kind") or ""),
                id=str(raw.get("id") or ""),
                tenant_id=str(raw.get("tenant_id") or ""),
                session_id=str(raw.get("session_id") or ""),
                deployment_id=str(raw.get("deployment_id") or ""),
                trace_id=str(raw.get("trace_id") or ""),
                tool_call_id=str(raw.get("tool_call_id") or ""),
                name=str(raw.get("name") or ""),
                status=str(raw.get("status") or ""),
                summary=str(raw.get("summary") or ""),
                attrs={
                    str(k): str(v)
                    for k, v in (raw.get("attrs") or {}).items()
                    if isinstance(raw.get("attrs"), dict)
                },
                updated_ts=_parse_ts(raw.get("updated_ts")),
            )
        )
    except (TypeError, ValueError):
        return None


class FileObjectStore:
    def __init__(self, path: Path) -> None:
        self.path = Path(path)

    def upsert(self, obj: UModelObject) -> UModelObject:
        cleaned = prepare_object(obj)
        if cleaned.updated_ts is None:
            cleaned.updated_ts = datetime.now(timezone.utc)
        rows = self._load_dicts()
        replaced = False
        out: list[dict[str, object]] = []
        for row in rows:
            if str(row.get("kind") or "") == cleaned.kind and str(row.get("id") or "") == cleaned.id:
                out.append(_object_to_dict(cleaned))
                replaced = True
            else:
                out.append(row)
        if not replaced:
            out.append(_object_to_dict(cleaned))
        self._save_dicts(out)
        return cleaned

    def get(
        self, kind: str, object_id: str, *, tenant_id: str = ""
    ) -> UModelObject | None:
        want_kind = str(kind or "").strip()
        want_id = str(object_id or "").strip()
        want_tenant = str(tenant_id or "").strip()
        if not want_kind or not want_id:
            return None
        for obj in self._load_objects():
            if obj.kind != want_kind or obj.id != want_id:
                continue
            if want_tenant and obj.tenant_id != want_tenant:
                continue
            return obj
        return None

    def list(self, scope: QueryScope, *, kind: str = "") -> list[UModelObject]:
        if scope_is_invalid(scope):
            return []
        want_kind = str(kind or "").strip()
        if want_kind and want_kind not in OBJECT_KINDS:
            return []
        session_id = (scope.session_id or "").strip()
        tenant_id = (scope.tenant_id or "").strip()
        deployment_id = (scope.deployment_id or "").strip()
        trace_id = (scope.trace_id or "").strip()
        matched: list[UModelObject] = []
        for obj in self._load_objects():
            if want_kind and obj.kind != want_kind:
                continue
            if session_id and obj.session_id != session_id:
                continue
            if tenant_id and obj.tenant_id != tenant_id:
                continue
            if deployment_id and obj.deployment_id != deployment_id:
                continue
            if trace_id and obj.trace_id != trace_id:
                continue
            matched.append(obj)
        return matched[: clamp_limit(scope.limit)]

    def _load_objects(self) -> list[UModelObject]:
        items: list[UModelObject] = []
        for row in self._load_dicts():
            obj = _object_from_dict(row)
            if obj is not None:
                items.append(obj)
        return items

    def _load_dicts(self) -> list[dict[str, object]]:
        if not self.path.is_file():
            return []
        try:
            data = json.loads(self.path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return []
        if not isinstance(data, dict):
            return []
        raw = data.get("objects")
        if not isinstance(raw, list):
            return []
        return [row for row in raw if isinstance(row, dict)]

    def _save_dicts(self, rows: list[dict[str, object]]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        payload = {"objects": rows}
        tmp = self.path.with_name(self.path.name + ".tmp")
        tmp.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
        tmp.replace(self.path)
