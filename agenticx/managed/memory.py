#!/usr/bin/env python3
"""Memory-store path rules and the control-plane client used by session mounts.

MA-A07 talks only to the MA-E07 internal HTTP API. The in-memory client is a
CAS-faithful stand-in for tests. Neither implementation writes the personal
workspace memory index.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import unicodedata
from dataclasses import dataclass
from typing import Literal, Protocol, Sequence

import httpx

MEMORY_PATH_MAX_BYTES = 1024
MEMORY_SEGMENT_MAX_BYTES = 255
MEMORY_CONTENT_MAX_BYTES = 102400
MEMORY_STORE_MAX_ITEMS = 2000
MEMORY_STORE_MAX_BYTES = 20 * 1024 * 1024
MEMORY_WRITE_BATCH = 50
MAX_MEMORY_RESOURCES = 8

_PATH_CONFLICT = "path conflicts with an existing memory"
_VERSION_CONFLICT = "memory has been modified"
_NOT_FOUND = "memory not found"
_LIMIT = "memory store limit reached (2000 memories / 20 MiB)"


class MemoryPathError(ValueError):
    """A memory path failed the same rules as the control plane."""


class MemoryServiceError(Exception):
    """Control-plane call failed. ``transient`` is True for network errors and 5xx."""

    def __init__(
        self,
        message: str,
        *,
        status: int = 0,
        code: str | None = None,
        transient: bool = False,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code
        self.transient = transient


def validate_memory_path(raw: str) -> str:
    """Return the NFC path, or raise ``MemoryPathError`` with an E07 reason."""
    if not isinstance(raw, str):
        raise MemoryPathError("path: must be a string")
    path = unicodedata.normalize("NFC", raw)
    if not path.startswith("/"):
        raise MemoryPathError('path: must start with "/"')
    if path == "/":
        raise MemoryPathError("path: must not be the root")
    if path.endswith("/"):
        raise MemoryPathError('path: must not end with "/"')
    if len(path.encode("utf-8")) > MEMORY_PATH_MAX_BYTES:
        raise MemoryPathError("path: exceeds 1024 bytes")
    if any(ord(char) < 0x20 or ord(char) == 0x7F for char in path) or "\\" in path:
        raise MemoryPathError("path: contains control characters or backslash")
    for segment in path[1:].split("/"):
        if segment in ("", ".", ".."):
            raise MemoryPathError('path: empty, "." or ".." segment')
        if len(segment.encode("utf-8")) > MEMORY_SEGMENT_MAX_BYTES:
            raise MemoryPathError("path: segment exceeds 255 bytes")
    return path


def content_sha256(content: str) -> str:
    """SHA-256 hex digest of the UTF-8 bytes of ``content``."""
    return hashlib.sha256(content.encode("utf-8")).hexdigest()


def _path_conflicts(
    candidate: str, existing: Sequence[str], *, ignore: str | None = None
) -> str | None:
    for entry in existing:
        if entry == ignore:
            continue
        if (
            entry == candidate
            or candidate.startswith(f"{entry}/")
            or entry.startswith(f"{candidate}/")
        ):
            return entry
    return None


@dataclass(frozen=True)
class MemoryStoreStatus:
    id: str
    status: Literal["active", "archived", "missing"]
    name: str | None


@dataclass(frozen=True)
class MemoryEntry:
    memory_id: str
    path: str
    content: str
    content_sha256: str
    version: int


@dataclass(frozen=True)
class MemorySnapshot:
    store_id: str
    name: str
    status: str
    entries: tuple[MemoryEntry, ...]


@dataclass(frozen=True)
class MemoryWriteOp:
    op: Literal["create", "update", "delete"]
    path: str
    content: str | None = None
    memory_id: str | None = None
    expected_version: int | None = None


@dataclass(frozen=True)
class MemoryHead:
    memory_id: str
    path: str
    version: int
    content_sha256: str


@dataclass(frozen=True)
class MemoryWriteResult:
    ok: bool
    code: str | None = None
    message: str = ""
    head: MemoryHead | None = None


def _head_of(entry: MemoryEntry) -> MemoryHead:
    return MemoryHead(
        memory_id=entry.memory_id,
        path=entry.path,
        version=entry.version,
        content_sha256=entry.content_sha256,
    )


class MemoryStoreClient(Protocol):
    """Subset of the memory control plane used while a session is mounted."""

    async def validate_store_ids(
        self,
        tenant_id: str,
        store_ids: Sequence[str],
    ) -> list[MemoryStoreStatus]: ...

    async def snapshot(
        self, tenant_id: str, session_id: str, store_id: str
    ) -> MemorySnapshot: ...

    async def write(
        self,
        tenant_id: str,
        session_id: str,
        store_id: str,
        ops: Sequence[MemoryWriteOp],
    ) -> list[MemoryWriteResult]: ...

    async def aclose(self) -> None: ...


class EnterpriseMemoryStoreClient:
    """HTTP client for ``/api/internal/ma/memory-stores``.

    The bearer token is sent on every request and is never included in
    ``repr`` or in raised messages.
    """

    def __init__(
        self,
        base_url: str,
        internal_token: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        timeout: float = 15.0,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._http = httpx.AsyncClient(
            base_url=self._base_url,
            timeout=timeout,
            trust_env=False,
            transport=transport,
            headers={"Authorization": f"Bearer {internal_token}"},
        )

    def __repr__(self) -> str:
        return f"EnterpriseMemoryStoreClient(base_url={self._base_url!r})"

    async def aclose(self) -> None:
        await self._http.aclose()

    async def validate_store_ids(
        self,
        tenant_id: str,
        store_ids: Sequence[str],
    ) -> list[MemoryStoreStatus]:
        body = await self._request(
            "POST",
            "/api/internal/ma/memory-stores/validate",
            json={"tenant_id": tenant_id, "memory_store_ids": list(store_ids)},
        )
        stores = body.get("memory_stores") if isinstance(body, dict) else None
        if not isinstance(stores, list):
            raise MemoryServiceError(
                "memory service returned 200", status=200, transient=True
            )
        out: list[MemoryStoreStatus] = []
        for item in stores:
            if not isinstance(item, dict) or not isinstance(item.get("id"), str):
                raise MemoryServiceError(
                    "memory service returned 200", status=200, transient=True
                )
            status = item.get("status")
            if status not in ("active", "archived", "missing"):
                raise MemoryServiceError(
                    "memory service returned 200", status=200, transient=True
                )
            name = item.get("name")
            out.append(
                MemoryStoreStatus(
                    id=item["id"],
                    status=status,
                    name=name if isinstance(name, str) else None,
                )
            )
        return out

    async def snapshot(
        self, tenant_id: str, session_id: str, store_id: str
    ) -> MemorySnapshot:
        body = await self._request(
            "GET",
            f"/api/internal/ma/memory-stores/{store_id}/snapshot",
            params={"tenant_id": tenant_id, "session_id": session_id},
        )
        if not isinstance(body, dict):
            raise MemoryServiceError(
                "memory service returned 200", status=200, transient=True
            )
        store = body.get("memory_store")
        memories = body.get("memories")
        if not isinstance(store, dict) or not isinstance(memories, list):
            raise MemoryServiceError(
                "memory service returned 200", status=200, transient=True
            )
        entries: list[MemoryEntry] = []
        for item in memories:
            if not isinstance(item, dict):
                raise MemoryServiceError(
                    "memory service returned 200", status=200, transient=True
                )
            try:
                entries.append(
                    MemoryEntry(
                        memory_id=str(item["id"]),
                        path=str(item["path"]),
                        content=(
                            item.get("content")
                            if isinstance(item.get("content"), str)
                            else ""
                        ),
                        content_sha256=str(item["content_sha256"]),
                        version=int(item["version"]),
                    )
                )
            except (KeyError, TypeError, ValueError):
                raise MemoryServiceError(
                    "memory service returned 200", status=200, transient=True
                ) from None
        name = store.get("name")
        return MemorySnapshot(
            store_id=str(store.get("id") or store_id),
            name=name if isinstance(name, str) else "",
            status=str(store.get("status") or ""),
            entries=tuple(entries),
        )

    async def write(
        self,
        tenant_id: str,
        session_id: str,
        store_id: str,
        ops: Sequence[MemoryWriteOp],
    ) -> list[MemoryWriteResult]:
        if not ops:
            return []
        combined: list[MemoryWriteResult] = []
        for start in range(0, len(ops), MEMORY_WRITE_BATCH):
            chunk = list(ops[start : start + MEMORY_WRITE_BATCH])
            body = await self._request(
                "POST",
                f"/api/internal/ma/memory-stores/{store_id}/writes",
                json={
                    "tenant_id": tenant_id,
                    "session_id": session_id,
                    "ops": [_op_payload(op) for op in chunk],
                },
            )
            results = body.get("results") if isinstance(body, dict) else None
            if not isinstance(results, list):
                raise MemoryServiceError(
                    "memory service returned 200", status=200, transient=True
                )
            by_index: dict[int, MemoryWriteResult] = {}
            for item in results:
                if not isinstance(item, dict) or not isinstance(item.get("index"), int):
                    raise MemoryServiceError(
                        "memory service returned 200", status=200, transient=True
                    )
                by_index[item["index"]] = _result_from_body(item)
            if len(by_index) != len(chunk) or any(
                index not in by_index for index in range(len(chunk))
            ):
                raise MemoryServiceError(
                    "memory service returned 200", status=200, transient=True
                )
            combined.extend(by_index[index] for index in range(len(chunk)))
        return combined

    async def _request(self, method: str, url: str, **kwargs: object) -> dict:
        try:
            response = await self._http.request(method, url, **kwargs)  # type: ignore[arg-type]
        except httpx.HTTPError:
            raise MemoryServiceError(
                "memory service unavailable", status=0, transient=True
            ) from None
        if response.status_code >= 400:
            raise _http_error(response)
        try:
            body = response.json()
        except ValueError:
            raise MemoryServiceError(
                f"memory service returned {response.status_code}",
                status=response.status_code,
                transient=True,
            ) from None
        if not isinstance(body, dict):
            raise MemoryServiceError(
                f"memory service returned {response.status_code}",
                status=response.status_code,
                transient=True,
            )
        return body


def _http_error(response: httpx.Response) -> MemoryServiceError:
    code: str | None = None
    parsed = True
    try:
        payload = response.json()
    except ValueError:
        payload = None
        parsed = False
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict) and isinstance(error.get("code"), str):
            code = error["code"]
    transient = response.status_code >= 500 or not parsed
    return MemoryServiceError(
        f"memory service returned {response.status_code}",
        status=response.status_code,
        code=code,
        transient=transient,
    )


def _op_payload(op: MemoryWriteOp) -> dict[str, object]:
    if op.op == "create":
        return {
            "op": "create",
            "path": op.path,
            "content": op.content if op.content is not None else "",
        }
    if op.op == "update":
        payload: dict[str, object] = {
            "op": "update",
            "memory_id": op.memory_id,
            "expected_version": op.expected_version,
        }
        if op.content is not None:
            payload["content"] = op.content
        return payload
    return {
        "op": "delete",
        "memory_id": op.memory_id,
        "expected_version": op.expected_version,
    }


def _head_from_mapping(raw: object) -> MemoryHead | None:
    if not isinstance(raw, dict):
        return None
    try:
        return MemoryHead(
            memory_id=str(raw["id"]),
            path=str(raw["path"]),
            version=int(raw["version"]),
            content_sha256=str(raw["content_sha256"]),
        )
    except (KeyError, TypeError, ValueError):
        return None


def _result_from_body(item: dict) -> MemoryWriteResult:
    if item.get("ok") is True:
        return MemoryWriteResult(ok=True, head=_head_from_mapping(item.get("memory")))
    code = item.get("code")
    message = item.get("message")
    return MemoryWriteResult(
        ok=False,
        code=code if isinstance(code, str) else None,
        message=message if isinstance(message, str) else "",
        head=_head_from_mapping(item.get("current")),
    )


class _Stored:
    def __init__(self, memory_id: str, path: str, content: str, version: int) -> None:
        self.memory_id = memory_id
        self.path = path
        self.content = content
        self.content_sha256 = content_sha256(content)
        self.version = version

    def entry(self) -> MemoryEntry:
        return MemoryEntry(
            memory_id=self.memory_id,
            path=self.path,
            content=self.content,
            content_sha256=self.content_sha256,
            version=self.version,
        )


class InMemoryMemoryStoreClient:
    """CAS-faithful in-process implementation for tests and local experiments.

    ``snapshot`` / ``write`` require ``mount()``. A session that never mounted
    the store receives 403, matching the control plane.
    """

    def __init__(self) -> None:
        self._stores: dict[str, dict] = {}
        self._mounts: dict[tuple[str, str], dict[str, str]] = {}
        self._next_id = 1

    def add_store(self, store_id: str, name: str, *, status: str = "active") -> None:
        self._stores[store_id] = {
            "name": name,
            "status": status,
            "items": {},
            "log": [],
        }

    def mount(
        self, tenant_id: str, session_id: str, store_id: str, access: str
    ) -> None:
        self._mounts.setdefault((tenant_id, session_id), {})[store_id] = access

    def put(self, store_id: str, path: str, content: str) -> MemoryHead:
        """Admin-style upsert. Does not consult a session mount or CAS."""
        normalized = validate_memory_path(path)
        store = self._require_store(store_id)
        items: dict[str, _Stored] = store["items"]
        current = items.get(normalized)
        if current is None:
            conflict = _path_conflicts(normalized, list(items))
            if conflict is not None:
                raise MemoryPathError(_PATH_CONFLICT)
            stored = _Stored(self._allocate_id(), normalized, content, 1)
            items[normalized] = stored
            self._log(store, stored, "created", None)
            return _head_of(stored.entry())
        stored = _Stored(current.memory_id, normalized, content, current.version + 1)
        items[normalized] = stored
        self._log(store, stored, "modified", None)
        return _head_of(stored.entry())

    def get(self, store_id: str, path: str) -> MemoryEntry | None:
        store = self._stores.get(store_id)
        if store is None:
            return None
        try:
            normalized = validate_memory_path(path)
        except MemoryPathError:
            return None
        stored = store["items"].get(normalized)
        if stored is None:
            return None
        return stored.entry()

    def versions(self, store_id: str) -> list[dict]:
        store = self._stores.get(store_id)
        if store is None:
            return []
        return [dict(item) for item in store["log"]]

    async def validate_store_ids(
        self,
        tenant_id: str,
        store_ids: Sequence[str],
    ) -> list[MemoryStoreStatus]:
        del tenant_id
        out: list[MemoryStoreStatus] = []
        for store_id in store_ids:
            store = self._stores.get(store_id)
            if store is None:
                out.append(MemoryStoreStatus(id=store_id, status="missing", name=None))
                continue
            status = store["status"]
            if status not in ("active", "archived"):
                status = "missing"
            out.append(
                MemoryStoreStatus(id=store_id, status=status, name=store["name"])
            )
        return out

    async def snapshot(
        self, tenant_id: str, session_id: str, store_id: str
    ) -> MemorySnapshot:
        access = self._mounts.get((tenant_id, session_id), {}).get(store_id)
        if access not in ("read_only", "read_write"):
            raise MemoryServiceError(
                "memory service returned 403",
                status=403,
                code="forbidden_scope",
                transient=False,
            )
        store = self._stores.get(store_id)
        if store is None:
            raise MemoryServiceError(
                "memory service returned 404",
                status=404,
                code="memory_store_not_found",
                transient=False,
            )
        items: dict[str, _Stored] = store["items"]
        entries = tuple(items[path].entry() for path in sorted(items))
        return MemorySnapshot(
            store_id=store_id,
            name=store["name"] or "",
            status=store["status"],
            entries=entries,
        )

    async def write(
        self,
        tenant_id: str,
        session_id: str,
        store_id: str,
        ops: Sequence[MemoryWriteOp],
    ) -> list[MemoryWriteResult]:
        access = self._mounts.get((tenant_id, session_id), {}).get(store_id)
        if access is None:
            raise MemoryServiceError(
                "memory service returned 403",
                status=403,
                code="forbidden_scope",
                transient=False,
            )
        if access != "read_write":
            raise MemoryServiceError(
                "memory service returned 403",
                status=403,
                code="forbidden_scope",
                transient=False,
            )
        store = self._stores.get(store_id)
        if store is None:
            raise MemoryServiceError(
                "memory service returned 404",
                status=404,
                code="memory_store_not_found",
                transient=False,
            )
        return [self._apply(store, session_id, op) for op in ops]

    async def aclose(self) -> None:
        return None

    def _apply(
        self, store: dict, session_id: str, op: MemoryWriteOp
    ) -> MemoryWriteResult:
        items: dict[str, _Stored] = store["items"]
        if op.op == "create":
            return self._create(store, session_id, op, items)
        if op.op == "delete":
            return self._delete(store, session_id, op, items)
        return self._update(store, session_id, op, items)

    def _create(
        self,
        store: dict,
        session_id: str,
        op: MemoryWriteOp,
        items: dict[str, _Stored],
    ) -> MemoryWriteResult:
        try:
            path = validate_memory_path(op.path)
        except MemoryPathError as exc:
            return MemoryWriteResult(ok=False, code="invalid_request", message=str(exc))
        if not isinstance(op.content, str):
            return MemoryWriteResult(
                ok=False, code="invalid_request", message="content: must be a string"
            )
        limited = self._limit_failure(op.content, items, extra_item=True)
        if limited is not None:
            return limited
        conflict = _path_conflicts(path, list(items))
        if conflict is not None:
            current = items.get(conflict)
            return MemoryWriteResult(
                ok=False,
                code="memory_path_conflict",
                message=_PATH_CONFLICT,
                head=_head_of(current.entry()) if current is not None else None,
            )
        stored = _Stored(self._allocate_id(), path, op.content, 1)
        items[path] = stored
        self._log(store, stored, "created", session_id)
        return MemoryWriteResult(ok=True, head=_head_of(stored.entry()))

    def _update(
        self,
        store: dict,
        session_id: str,
        op: MemoryWriteOp,
        items: dict[str, _Stored],
    ) -> MemoryWriteResult:
        current = self._by_id(items, op.memory_id)
        if current is None:
            return MemoryWriteResult(
                ok=False, code="memory_not_found", message=_NOT_FOUND
            )
        if current.version != op.expected_version:
            return MemoryWriteResult(
                ok=False,
                code="memory_version_conflict",
                message=_VERSION_CONFLICT,
                head=_head_of(current.entry()),
            )
        if op.content is None:
            return MemoryWriteResult(
                ok=False,
                code="invalid_request",
                message="path or content is required",
            )
        if content_sha256(op.content) == current.content_sha256 and op.path in (
            "",
            current.path,
        ):
            return MemoryWriteResult(ok=True, head=_head_of(current.entry()))
        limited = self._limit_failure(op.content, items, replacing=current)
        if limited is not None:
            return limited
        try:
            path = validate_memory_path(op.path) if op.path else current.path
        except MemoryPathError as exc:
            return MemoryWriteResult(ok=False, code="invalid_request", message=str(exc))
        conflict = _path_conflicts(path, list(items), ignore=current.path)
        if conflict is not None:
            other = items.get(conflict)
            return MemoryWriteResult(
                ok=False,
                code="memory_path_conflict",
                message=_PATH_CONFLICT,
                head=_head_of(other.entry()) if other is not None else None,
            )
        if path != current.path:
            items.pop(current.path, None)
        stored = _Stored(current.memory_id, path, op.content, current.version + 1)
        items[path] = stored
        self._log(store, stored, "modified", session_id)
        return MemoryWriteResult(ok=True, head=_head_of(stored.entry()))

    def _delete(
        self,
        store: dict,
        session_id: str,
        op: MemoryWriteOp,
        items: dict[str, _Stored],
    ) -> MemoryWriteResult:
        current = self._by_id(items, op.memory_id)
        if current is None:
            return MemoryWriteResult(
                ok=False, code="memory_not_found", message=_NOT_FOUND
            )
        if current.version != op.expected_version:
            return MemoryWriteResult(
                ok=False,
                code="memory_version_conflict",
                message=_VERSION_CONFLICT,
                head=_head_of(current.entry()),
            )
        removed = _Stored(
            current.memory_id, current.path, current.content, current.version + 1
        )
        items.pop(current.path, None)
        self._log(store, removed, "deleted", session_id)
        return MemoryWriteResult(ok=True, head=None)

    def _limit_failure(
        self,
        content: str,
        items: dict[str, _Stored],
        *,
        extra_item: bool = False,
        replacing: _Stored | None = None,
    ) -> MemoryWriteResult | None:
        if "\x00" in content:
            return MemoryWriteResult(
                ok=False,
                code="invalid_request",
                message="content: must not contain NUL",
            )
        size = len(content.encode("utf-8"))
        if size > MEMORY_CONTENT_MAX_BYTES:
            return MemoryWriteResult(
                ok=False, code="memory_store_limit", message="content: exceeds 100 KiB"
            )
        count = len(items) + (1 if extra_item else 0)
        total = sum(len(item.content.encode("utf-8")) for item in items.values())
        if replacing is not None:
            total -= len(replacing.content.encode("utf-8"))
        total += size
        if count > MEMORY_STORE_MAX_ITEMS or total > MEMORY_STORE_MAX_BYTES:
            return MemoryWriteResult(
                ok=False, code="memory_store_limit", message=_LIMIT
            )
        return None

    def _by_id(
        self, items: dict[str, _Stored], memory_id: str | None
    ) -> _Stored | None:
        if not memory_id:
            return None
        for item in items.values():
            if item.memory_id == memory_id:
                return item
        return None

    def _allocate_id(self) -> str:
        memory_id = f"M{self._next_id:025d}"
        self._next_id += 1
        return memory_id

    def _require_store(self, store_id: str) -> dict:
        store = self._stores.get(store_id)
        if store is None:
            raise MemoryServiceError(
                "memory service returned 404",
                status=404,
                code="memory_store_not_found",
                transient=False,
            )
        return store

    def _log(
        self, store: dict, stored: _Stored, operation: str, session_id: str | None
    ) -> None:
        store["log"].append(
            {
                "memory_id": stored.memory_id,
                "version": stored.version,
                "operation": operation,
                "path": stored.path,
                "source_session_id": session_id,
            }
        )


__all__ = [
    "MAX_MEMORY_RESOURCES",
    "MEMORY_CONTENT_MAX_BYTES",
    "MEMORY_PATH_MAX_BYTES",
    "MEMORY_SEGMENT_MAX_BYTES",
    "MEMORY_STORE_MAX_BYTES",
    "MEMORY_STORE_MAX_ITEMS",
    "MEMORY_WRITE_BATCH",
    "EnterpriseMemoryStoreClient",
    "InMemoryMemoryStoreClient",
    "MemoryEntry",
    "MemoryHead",
    "MemoryPathError",
    "MemoryServiceError",
    "MemorySnapshot",
    "MemoryStoreClient",
    "MemoryStoreStatus",
    "MemoryWriteOp",
    "MemoryWriteResult",
    "content_sha256",
    "validate_memory_path",
]
