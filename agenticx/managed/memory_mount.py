#!/usr/bin/env python3
"""Mount memory stores into a managed session work directory and CAS-sync them.

Read-only mounts are never written back. Conflicts keep the remote bytes and
save this session's bytes under a ``.conflict-<session>`` path.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import logging
import os
import re
import stat
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from agenticx.managed.errors import FORBIDDEN_SCOPE, INTERNAL, INVALID_REQUEST, MAError
from agenticx.managed.events import session_error_event
from agenticx.managed.extensions import TurnContribution, TurnSetupError
from agenticx.managed.memory import (
    MAX_MEMORY_RESOURCES,
    MEMORY_CONTENT_MAX_BYTES,
    MEMORY_STORE_MAX_ITEMS,
    MEMORY_WRITE_BATCH,
    MemoryPathError,
    MemoryServiceError,
    MemoryStoreClient,
    MemoryWriteOp,
    MemoryWriteResult,
    content_sha256,
    validate_memory_path,
)
from agenticx.runtime.hooks import AgentHook, HookOutcome

logger = logging.getLogger(__name__)

EXTENSION_NAME = "memory"
MEMORY_DIR_NAME = "memory"
BASELINE_DIR_NAME = "memory-baseline"
WRITE_TOOLS = frozenset({"file_write", "file_edit"})
RETRY_DELAYS_SECONDS = (0.5, 1.0, 2.0)
CONFLICT_SUFFIX_MAX = 9
RESOURCE_KEYS = frozenset({"type", "memory_store_id", "access", "instructions"})
_CONFLICT_CODES = frozenset({"memory_version_conflict", "memory_path_conflict"})


def mount_name_for(name: str, store_id: str) -> str:
    """Directory slug ``<name>-<store id tail>`` with characters safe for a path."""
    slug = unicodedata.normalize("NFKC", name).lower()
    slug = re.sub(r"[^\w-]+", "-", slug, flags=re.UNICODE).strip("-")[:48]
    if not slug or slug in {".", ".."} or "/" in slug or "\\" in slug:
        slug = "store"
    tail = store_id[-6:].lower()
    return f"{slug}-{tail}"


def make_resources_validator(client: MemoryStoreClient):
    """Create-session validator for ``resources``."""

    async def validate(
        principal: Any, req: Any, environment: Any
    ) -> list[dict[str, Any]]:
        items = list(req.resources)
        if environment.type == "desktop_worker":
            raise MAError(
                INVALID_REQUEST,
                "resources are not supported for desktop_worker environments",
            )
        if len(items) > MAX_MEMORY_RESOURCES:
            raise MAError(INVALID_REQUEST, "resources must contain at most 8 items")
        parsed: list[tuple[str, str, str | None]] = []
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                raise MAError(INVALID_REQUEST, f"resources[{index}]: must be an object")
            for key in sorted(set(item) - RESOURCE_KEYS):
                raise MAError(
                    INVALID_REQUEST, f"resources[{index}].{key}: unknown field"
                )
            if item.get("type") != "memory_store":
                raise MAError(
                    INVALID_REQUEST, f"resources[{index}].type: must be memory_store"
                )
            store_id = item.get("memory_store_id")
            if not isinstance(store_id, str) or not 1 <= len(store_id) <= 64:
                raise MAError(
                    INVALID_REQUEST, f"resources[{index}].memory_store_id: required"
                )
            access = item.get("access", "read_write")
            if access not in ("read_only", "read_write"):
                raise MAError(
                    INVALID_REQUEST,
                    f"resources[{index}].access: must be read_only or read_write",
                )
            instructions = item.get("instructions")
            if instructions is not None and (
                not isinstance(instructions, str) or len(instructions) > 4096
            ):
                raise MAError(
                    INVALID_REQUEST,
                    f"resources[{index}].instructions: must be a string of at most 4096 characters",
                )
            scopes = principal.scopes
            if "ma:admin" not in scopes:
                if access == "read_write" and "ma:memory:write" not in scopes:
                    raise MAError(
                        FORBIDDEN_SCOPE,
                        "read_write memory mounts require ma:memory:write",
                        details={"scope": "ma:memory:write"},
                    )
                if access == "read_only" and not (
                    {"ma:memory:read", "ma:memory:write"} & set(scopes)
                ):
                    raise MAError(
                        FORBIDDEN_SCOPE,
                        "memory mounts require ma:memory:read",
                        details={"scope": "ma:memory:read"},
                    )
            parsed.append((store_id, access, instructions))
        ids = [item[0] for item in parsed]
        if len(set(ids)) != len(ids):
            raise MAError(
                INVALID_REQUEST, "resources must not mount the same memory store twice"
            )
        try:
            statuses = {
                item.id: item
                for item in await client.validate_store_ids(principal.tenant_id, ids)
            }
        except MemoryServiceError:
            raise MAError(INTERNAL, "memory service unavailable") from None
        out: list[dict[str, Any]] = []
        taken: set[str] = set()
        for store_id, access, instructions in parsed:
            status = statuses.get(store_id)
            if status is None or status.status == "missing":
                raise MAError(INVALID_REQUEST, f"memory store not found: {store_id}")
            if status.status != "active":
                raise MAError(INVALID_REQUEST, f"memory store is archived: {store_id}")
            base = mount_name_for(status.name or "store", store_id)
            mount_name = base
            suffix = 2
            while mount_name in taken:
                mount_name = f"{base}-{suffix}"
                suffix += 1
            taken.add(mount_name)
            out.append(
                {
                    "type": "memory_store",
                    "memory_store_id": store_id,
                    "access": access,
                    "instructions": instructions,
                    "name": status.name,
                    "mount_name": mount_name,
                    "mount_path": f"{MEMORY_DIR_NAME}/{mount_name}",
                }
            )
        return out

    return validate


@dataclass
class MountSpec:
    store_id: str
    name: str
    access: str
    instructions: str | None
    mount_name: str


def _entry_record(memory_id: str, version: int, sha256: str) -> dict[str, Any]:
    return {"memory_id": memory_id, "version": version, "sha256": sha256}


class MemoryMount:
    """One store mounted under ``workdir/memory/<mount_name>``."""

    def __init__(
        self,
        *,
        spec: MountSpec,
        client: MemoryStoreClient,
        tenant_id: str,
        session_id: str,
        workdir: Path,
    ) -> None:
        self.spec = spec
        self._client = client
        self._tenant_id = tenant_id
        self._session_id = session_id
        self._workdir = Path(workdir)
        self._baseline_path = (
            self._workdir.parent / BASELINE_DIR_NAME / f"{spec.mount_name}.json"
        )
        self._entries: dict[str, dict[str, Any]] = self._load_baseline()
        self._lock = asyncio.Lock()
        self._reported: set[tuple[str, str]] = set()
        self._preserve_paths: set[str] = set()
        self._suppress_delete: set[str] = set()
        self._conflict_saved_sha: dict[str, str] = {}
        self._sync_failure_note = ""

    @property
    def root(self) -> Path:
        return self._workdir / MEMORY_DIR_NAME / self.spec.mount_name

    @property
    def writable(self) -> bool:
        return self.spec.access == "read_write"

    async def materialize(self) -> list[dict[str, Any]]:
        """Replace the mount tree with the control-plane snapshot."""
        async with self._lock:
            snap = await self._client.snapshot(
                self._tenant_id, self._session_id, self.spec.store_id
            )
            root = self.root
            root.mkdir(parents=True, exist_ok=True)
            _make_tree_writable(root)
            desired = {entry.path: entry for entry in snap.entries}
            preserve = set(self._preserve_paths)
            events: list[dict[str, Any]] = []
            desired_dirs = _ancestor_dirs(desired)
            for rel, kind in _walk(root):
                if rel in preserve:
                    continue
                if kind == "file" and rel in desired:
                    continue
                if kind == "dir" and (rel in desired_dirs or rel in desired):
                    if rel in desired:
                        _remove(root, rel, kind)
                    continue
                if kind == "dir":
                    continue
                _remove(root, rel, kind)
            _prune_empty_dirs(root)
            written: dict[str, str] = {}
            new_entries: dict[str, dict[str, Any]] = {}
            for path in preserve:
                if path in self._entries:
                    new_entries[path] = dict(self._entries[path])
            for path, entry in sorted(desired.items()):
                if path in preserve:
                    continue
                key = os.path.normcase(path)
                if key in written:
                    events.extend(
                        _reject_once(
                            self,
                            path,
                            "path collides with another entry on this filesystem",
                        )
                    )
                    self._suppress_delete.add(path)
                    new_entries[path] = _entry_record(
                        entry.memory_id, entry.version, entry.content_sha256
                    )
                    continue
                target = _target(root, path)
                ancestors = [
                    parent
                    for parent in target.parents
                    if parent != root and root in parent.parents
                ]
                if any(parent.is_file() for parent in ancestors):
                    events.extend(_reject_once(self, path, "path collides with a file"))
                    self._suppress_delete.add(path)
                    new_entries[path] = _entry_record(
                        entry.memory_id, entry.version, entry.content_sha256
                    )
                    continue
                if target.is_dir() and not target.is_symlink():
                    events.extend(
                        _reject_once(self, path, "path collides with a directory")
                    )
                    self._suppress_delete.add(path)
                    new_entries[path] = _entry_record(
                        entry.memory_id, entry.version, entry.content_sha256
                    )
                    continue
                target.parent.mkdir(parents=True, exist_ok=True)
                needs_write = True
                if target.is_symlink():
                    target.unlink()
                elif target.is_file():
                    try:
                        current = target.read_text(encoding="utf-8", errors="replace")
                    except OSError:
                        current = None
                    if (
                        current is not None
                        and content_sha256(current) == entry.content_sha256
                    ):
                        needs_write = False
                if needs_write:
                    _atomic_write(target, entry.content)
                written[key] = path
                new_entries[path] = _entry_record(
                    entry.memory_id, entry.version, entry.content_sha256
                )
                self._suppress_delete.discard(path)
                self._conflict_saved_sha.pop(path, None)
                self._preserve_paths.discard(path)
            for path in preserve:
                self._conflict_saved_sha.pop(path, None)
            self._entries = new_entries
            self._save_baseline()
            if not self.writable:
                _make_tree_read_only(root)
            return events

    async def flush(self) -> list[dict[str, Any]]:
        """Push local changes. Read-only mounts return no events and write nothing."""
        if not self.writable:
            return []
        async with self._lock:
            return await self._flush_locked()

    def detect_local_changes(self) -> bool:
        """True when a read-only tree no longer matches the last snapshot."""
        local: dict[str, str] = {}
        root = self.root
        if not root.exists():
            return bool(self._entries)
        for rel, kind in _walk(root):
            if kind != "file":
                return True
            if rel not in self._entries:
                return True
            target = _target(root, rel)
            try:
                text = target.read_text(encoding="utf-8")
            except (OSError, UnicodeDecodeError):
                return True
            local[rel] = content_sha256(text)
        for path, base in self._entries.items():
            if path not in local or local[path] != base.get("sha256"):
                return True
        return False

    async def _flush_locked(self) -> list[dict[str, Any]]:
        events: list[dict[str, Any]] = []
        local: dict[str, tuple[str, str]] = {}
        root = self.root
        if root.exists():
            for rel, kind in _walk(root):
                if kind == "symlink":
                    events.extend(
                        _reject_once(self, rel, "symbolic links are not synced")
                    )
                    continue
                if kind != "file":
                    continue
                try:
                    path = validate_memory_path(rel)
                except MemoryPathError as exc:
                    events.extend(_reject_once(self, rel, str(exc)))
                    continue
                try:
                    raw = _target(root, path).read_bytes()
                except OSError as exc:
                    events.extend(
                        _reject_once(
                            self, path, f"file could not be read ({type(exc).__name__})"
                        )
                    )
                    continue
                if len(raw) > MEMORY_CONTENT_MAX_BYTES:
                    events.extend(_reject_once(self, path, "file exceeds 100 KiB"))
                    continue
                try:
                    text = raw.decode("utf-8")
                except UnicodeDecodeError:
                    events.extend(_reject_once(self, path, "file is not UTF-8 text"))
                    continue
                if "\x00" in text:
                    events.extend(_reject_once(self, path, "file contains NUL"))
                    continue
                if len(local) >= MEMORY_STORE_MAX_ITEMS:
                    events.extend(
                        _reject_once(self, path, "memory store item limit reached")
                    )
                    continue
                local[path] = (text, content_sha256(text))
        ops: list[MemoryWriteOp] = []
        for path, (text, sha) in sorted(local.items()):
            base = self._entries.get(path)
            if base is None:
                ops.append(MemoryWriteOp("create", path, content=text))
            elif base.get("sha256") != sha:
                if self._conflict_saved_sha.get(path) == sha:
                    continue
                ops.append(
                    MemoryWriteOp(
                        "update",
                        path,
                        content=text,
                        memory_id=str(base.get("memory_id") or ""),
                        expected_version=int(base.get("version") or 0),
                    )
                )
        for path, base in sorted(self._entries.items()):
            if path in local or path in self._suppress_delete:
                continue
            ops.append(
                MemoryWriteOp(
                    "delete",
                    path,
                    memory_id=str(base.get("memory_id") or ""),
                    expected_version=int(base.get("version") or 0),
                )
            )
        if not ops:
            return events
        for start in range(0, len(ops), MEMORY_WRITE_BATCH):
            chunk = ops[start : start + MEMORY_WRITE_BATCH]
            results = await self._write_with_retry(chunk)
            if results is None:
                self._preserve_paths.update(op.path for op in chunk)
                self._save_baseline()
                note = self._sync_failure_note or "will retry"
                events.append(
                    session_error_event(
                        "memory_sync_failed",
                        f"memory store {self.spec.name}: sync failed, {note}"[:500],
                        "exhausted",
                    )
                )
                return events
            for op, result in zip(chunk, results):
                events.extend(await self._apply_result(op, result, local))
            self._save_baseline()
        return events

    async def _write_with_retry(
        self, ops: Sequence[MemoryWriteOp]
    ) -> list[MemoryWriteResult] | None:
        self._sync_failure_note = ""
        delays = RETRY_DELAYS_SECONDS
        attempts = 1 + len(delays)
        for attempt in range(attempts):
            try:
                return await self._client.write(
                    self._tenant_id, self._session_id, self.spec.store_id, ops
                )
            except MemoryServiceError as exc:
                if not exc.transient:
                    self._sync_failure_note = f"status {exc.status}"
                    return None
                if attempt >= len(delays):
                    self._sync_failure_note = "will retry"
                    return None
                await asyncio.sleep(delays[attempt])
        self._sync_failure_note = "will retry"
        return None

    async def _apply_result(
        self,
        op: MemoryWriteOp,
        result: MemoryWriteResult,
        local: dict[str, tuple[str, str]],
        *,
        allow_recreate: bool = True,
    ) -> list[dict[str, Any]]:
        if result.ok and op.op in ("create", "update") and result.head is not None:
            self._entries[op.path] = _entry_record(
                result.head.memory_id,
                result.head.version,
                result.head.content_sha256,
            )
            self._preserve_paths.discard(op.path)
            self._conflict_saved_sha.pop(op.path, None)
            return []
        if result.ok and op.op == "delete":
            self._entries.pop(op.path, None)
            self._preserve_paths.discard(op.path)
            self._suppress_delete.discard(op.path)
            return []
        if result.ok:
            return [
                session_error_event(
                    "memory_sync_failed",
                    f"memory {op.path}: sync failed, will retry",
                    "exhausted",
                )
            ]
        code = result.code or ""
        if code in _CONFLICT_CODES and result.head is not None and op.op != "delete":
            local_sha = local.get(op.path, (None, None))[1]
            if local_sha is not None and result.head.content_sha256 == local_sha:
                self._entries[op.path] = _entry_record(
                    result.head.memory_id,
                    result.head.version,
                    result.head.content_sha256,
                )
                self._preserve_paths.discard(op.path)
                self._conflict_saved_sha.pop(op.path, None)
                return []
        if code in _CONFLICT_CODES and result.head is not None and op.op == "delete":
            self._entries[op.path] = _entry_record(
                result.head.memory_id,
                result.head.version,
                result.head.content_sha256,
            )
            self._suppress_delete.add(op.path)
            self._preserve_paths.discard(op.path)
            return [
                session_error_event(
                    "memory_write_conflict",
                    f"memory {op.path} was changed by another writer; the deletion was not applied",
                    "exhausted",
                )
            ]
        if code in _CONFLICT_CODES and op.op in ("create", "update"):
            saved = await self._save_conflict_copy(op.path, op.content or "")
            if saved is None:
                self._preserve_paths.add(op.path)
                return [
                    session_error_event(
                        "memory_sync_failed",
                        f"memory {op.path}: conflict copy could not be saved",
                        "exhausted",
                    )
                ]
            conflict_path, new_head = saved
            if result.head is None:
                self._entries.pop(op.path, None)
            else:
                self._entries[op.path] = _entry_record(
                    result.head.memory_id,
                    result.head.version,
                    result.head.content_sha256,
                )
            self._entries[conflict_path] = _entry_record(
                new_head.memory_id,
                new_head.version,
                new_head.content_sha256,
            )
            self._write_local(conflict_path, op.content or "")
            local_sha = local.get(op.path, (None, None))[1]
            if isinstance(local_sha, str):
                self._conflict_saved_sha[op.path] = local_sha
            self._preserve_paths.discard(op.path)
            return [
                session_error_event(
                    "memory_write_conflict",
                    (
                        f"memory {op.path} was changed by another writer; "
                        f"this session's version was saved as {conflict_path}"
                    ),
                    "exhausted",
                )
            ]
        if code == "memory_not_found" and op.op == "update" and allow_recreate:
            try:
                retried = await self._client.write(
                    self._tenant_id,
                    self._session_id,
                    self.spec.store_id,
                    [MemoryWriteOp("create", op.path, content=op.content)],
                )
            except MemoryServiceError as exc:
                self._preserve_paths.add(op.path)
                note = f"status {exc.status}" if exc.status else "will retry"
                return [
                    session_error_event(
                        "memory_sync_failed",
                        f"memory store {self.spec.name}: sync failed, {note}"[:500],
                        "exhausted",
                    )
                ]
            if not retried:
                self._preserve_paths.add(op.path)
                return [
                    session_error_event(
                        "memory_sync_failed",
                        f"memory {op.path}: sync failed, will retry",
                        "exhausted",
                    )
                ]
            return await self._apply_result(
                MemoryWriteOp("create", op.path, content=op.content),
                retried[0],
                local,
                allow_recreate=False,
            )
        if code == "memory_not_found" and op.op == "delete":
            self._entries.pop(op.path, None)
            self._preserve_paths.discard(op.path)
            self._suppress_delete.discard(op.path)
            return []
        if code in {"memory_store_limit", "invalid_request"}:
            return _reject_once(self, op.path, result.message or code)
        self._preserve_paths.add(op.path)
        return [
            session_error_event(
                "memory_sync_failed",
                f"memory {op.path}: sync failed, will retry",
                "exhausted",
            )
        ]

    async def _save_conflict_copy(
        self, path: str, content: str
    ) -> tuple[str, Any] | None:
        sid8 = self._session_id[-8:].lower()
        candidates = [f"{path}.conflict-{sid8}"]
        for suffix in range(2, CONFLICT_SUFFIX_MAX + 1):
            candidates.append(f"{path}.conflict-{sid8}-{suffix}")
        for candidate in candidates:
            try:
                validate_memory_path(candidate)
            except MemoryPathError:
                continue
            try:
                results = await self._client.write(
                    self._tenant_id,
                    self._session_id,
                    self.spec.store_id,
                    [MemoryWriteOp("create", candidate, content=content)],
                )
            except MemoryServiceError:
                return None
            if not results:
                return None
            result = results[0]
            if result.ok and result.head is not None:
                return candidate, result.head
            if result.code == "memory_path_conflict":
                continue
            return None
        return None

    def _write_local(self, path: str, content: str) -> None:
        root = self.root
        root.mkdir(parents=True, exist_ok=True)
        _make_tree_writable(root)
        target = _target(root, path)
        target.parent.mkdir(parents=True, exist_ok=True)
        _atomic_write(target, content)

    def _load_baseline(self) -> dict[str, dict[str, Any]]:
        path = self._baseline_path
        if not path.is_file():
            return {}
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
            entries = payload.get("entries") if isinstance(payload, dict) else None
            if not isinstance(entries, dict):
                raise ValueError("entries")
            loaded: dict[str, dict[str, Any]] = {}
            for key, value in entries.items():
                if not isinstance(key, str) or not isinstance(value, dict):
                    raise ValueError("entry")
                loaded[key] = {
                    "memory_id": str(value.get("memory_id") or ""),
                    "version": int(value["version"]),
                    "sha256": str(value.get("sha256") or ""),
                }
            return loaded
        except (OSError, ValueError, TypeError, json.JSONDecodeError, KeyError):
            logger.warning("memory baseline unreadable mount=%s", self.spec.mount_name)
            return {}

    def _save_baseline(self) -> None:
        path = self._baseline_path
        path.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "store_id": self.spec.store_id,
            "mount_name": self.spec.mount_name,
            "access": self.spec.access,
            "entries": self._entries,
        }
        raw = json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
        temporary = path.with_suffix(".json.tmp")
        fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        try:
            os.write(fd, raw)
            os.close(fd)
            fd = -1
            os.replace(temporary, path)
            os.chmod(path, 0o600)
        finally:
            if fd >= 0:
                os.close(fd)
            if temporary.exists():
                temporary.unlink(missing_ok=True)


def _reject_once(mount: MemoryMount, path: str, reason: str) -> list[dict[str, Any]]:
    key = (path, reason)
    if key in mount._reported:
        return []
    mount._reported.add(key)
    message = f"memory {mount.spec.name}{path}: {reason}"[:500]
    return [session_error_event("memory_entry_rejected", message, "exhausted")]


def _ancestor_dirs(desired: dict[str, Any]) -> set[str]:
    found: set[str] = set()
    for path in desired:
        parts = path.strip("/").split("/")
        acc = ""
        for part in parts[:-1]:
            acc += "/" + part
            found.add(unicodedata.normalize("NFC", acc))
    return found


def _target(root: Path, path: str) -> Path:
    return root.joinpath(*path.lstrip("/").split("/"))


def _walk(root: Path) -> list[tuple[str, str]]:
    if not root.exists():
        return []
    found: list[tuple[str, str]] = []

    def visit(directory: Path) -> None:
        try:
            entries = list(os.scandir(directory))
        except OSError:
            return
        for entry in entries:
            rel = "/" + unicodedata.normalize(
                "NFC", Path(entry.path).relative_to(root).as_posix()
            )
            try:
                symlink = entry.is_symlink()
            except OSError:
                found.append((rel, "other"))
                continue
            if symlink:
                found.append((rel, "symlink"))
                continue
            if entry.is_dir(follow_symlinks=False):
                found.append((rel, "dir"))
                visit(Path(entry.path))
                continue
            if entry.is_file(follow_symlinks=False):
                found.append((rel, "file"))
                continue
            found.append((rel, "other"))

    visit(root)
    return found


def _remove(root: Path, rel: str, kind: str) -> None:
    target = _target(root, rel)
    try:
        if kind == "dir" and not target.is_symlink():
            if target.is_dir():
                for child, child_kind in _walk(target):
                    _remove(target, child, child_kind)
                target.rmdir()
            return
        target.unlink(missing_ok=True)
    except OSError:
        logger.debug("memory mount could not remove path=%s", rel)


def _prune_empty_dirs(root: Path) -> None:
    if not root.exists():
        return
    for dirpath, _dirnames, _filenames in os.walk(
        root, topdown=False, followlinks=False
    ):
        path = Path(dirpath)
        if path == root or path.is_symlink():
            continue
        try:
            if any(path.iterdir()):
                continue
            path.rmdir()
        except OSError:
            logger.debug("memory mount could not prune %s", path)


def _chmod(path: Path, mode: int) -> None:
    try:
        if path.is_symlink():
            return
        os.chmod(path, mode)
    except OSError:
        logger.debug("memory mount chmod failed path=%s", path)


def _make_tree_writable(root: Path) -> None:
    if not root.exists():
        return
    for dirpath, _dirnames, filenames in os.walk(root, followlinks=False):
        current = Path(dirpath)
        if current.is_symlink():
            continue
        try:
            os.chmod(current, current.stat().st_mode | stat.S_IWUSR)
        except OSError:
            logger.debug("memory mount chmod u+w failed path=%s", current)
        for name in filenames:
            child = current / name
            if child.is_symlink():
                continue
            try:
                os.chmod(child, child.stat().st_mode | stat.S_IWUSR)
            except OSError:
                logger.debug("memory mount chmod u+w failed path=%s", child)


def _make_tree_read_only(root: Path) -> None:
    if not root.exists():
        return
    for dirpath, _dirnames, filenames in os.walk(root, followlinks=False):
        current = Path(dirpath)
        for name in filenames:
            _chmod(current / name, 0o444)
        _chmod(current, 0o555)
    _chmod(root, 0o555)


def _atomic_write(target: Path, content: str) -> None:
    temporary = target.with_name(f".{target.name}.memtmp")
    fd = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o644)
    try:
        os.write(fd, content.encode("utf-8"))
        os.close(fd)
        fd = -1
        os.replace(temporary, target)
    finally:
        if fd >= 0:
            os.close(fd)
        if temporary.exists():
            temporary.unlink(missing_ok=True)


def _is_within(resolved: Path, root: Path) -> bool:
    return resolved == root or root in resolved.parents


def _resolve_tool_path(raw: str, workdir: Path) -> Path:
    path = Path(raw).expanduser()
    if not path.is_absolute():
        path = workdir / path
    return path.resolve(strict=False)


class MemoryMountHook(AgentHook):
    """Block writes into read-only mounts and sync writable mounts after a write.

    ``after_tool_call`` does not receive the tool arguments, so a successful
    write remembers the path queued by ``before_tool_call``.
    """

    def __init__(
        self, actor: Any, mounts: Sequence[MemoryMount], workdir: Path
    ) -> None:
        self._actor = actor
        self._mounts = list(mounts)
        self._workdir = Path(workdir)
        self._pending_paths: list[str] = []

    async def before_tool_call(
        self,
        tool_name: str,
        arguments: dict[str, Any],
        session: Any,
    ) -> HookOutcome | None:
        del session
        if tool_name not in WRITE_TOOLS:
            return None
        raw = arguments.get("path") if isinstance(arguments, dict) else None
        if not isinstance(raw, str):
            return None
        resolved = _resolve_tool_path(raw, self._workdir)
        for mount in self._mounts:
            if mount.writable:
                continue
            root = mount.root.resolve(strict=False)
            if _is_within(resolved, root):
                name = f"{MEMORY_DIR_NAME}/{mount.spec.mount_name}"
                return HookOutcome(
                    blocked=True,
                    reason=(
                        f"ERROR: path is read-only (memory store mounted read_only): {name}. "
                        "Do not retry file_write/file_edit/bash_exec on this path."
                    ),
                )
        self._pending_paths.append(raw)
        return None

    async def after_tool_call(
        self, tool_name: str, result: str, session: Any
    ) -> str | None:
        del session
        if tool_name not in WRITE_TOOLS:
            return None
        raw = self._pending_paths.pop(0) if self._pending_paths else None
        text = result if isinstance(result, str) else str(result)
        if raw is None or text.startswith(("ERROR:", "CANCELLED:")):
            return None
        resolved = _resolve_tool_path(raw, self._workdir)
        for mount in self._mounts:
            if not mount.writable:
                continue
            root = mount.root.resolve(strict=False)
            if not _is_within(resolved, root):
                continue
            events = await mount.flush()
            if events:
                await self._actor.append(events)
            break
        return None


def _prompt(specs: Sequence[MountSpec]) -> str:
    lines = [
        "[memory]",
        "Memory stores are mounted as plain files under the working directory. "
        "Use file_read / list_files to read them.",
    ]
    for spec in specs:
        if spec.access == "read_write":
            lines.append(
                f"- memory/{spec.mount_name}/ (read_write): files you create, edit or delete "
                "here are saved as new versions after each file_write/file_edit and at the "
                "end of the turn. Never store secrets or credentials in memory."
            )
        else:
            lines.append(
                f"- memory/{spec.mount_name}/ (read_only): reference material; do not modify it."
            )
        if spec.instructions:
            lines.append(f"  Instructions: {spec.instructions}")
    return "\n".join(lines)


def _specs_from_record(resources: Sequence[Any]) -> list[MountSpec]:
    specs: list[MountSpec] = []
    for item in resources:
        if not isinstance(item, dict) or item.get("type") != "memory_store":
            continue
        store_id = item.get("memory_store_id")
        if not isinstance(store_id, str) or not store_id:
            continue
        name = (
            item.get("name")
            if isinstance(item.get("name"), str) and item.get("name")
            else "store"
        )
        access = (
            item.get("access")
            if item.get("access") in ("read_only", "read_write")
            else "read_write"
        )
        instructions = (
            item.get("instructions")
            if isinstance(item.get("instructions"), str)
            else None
        )
        mount_name = item.get("mount_name")
        if not isinstance(mount_name, str) or not mount_name:
            mount_name = mount_name_for(item.get("name") or "store", store_id)
        specs.append(
            MountSpec(
                store_id=store_id,
                name=name,
                access=access,
                instructions=instructions,
                mount_name=mount_name,
            )
        )
    return specs


class MemoryMountExtension:
    """Session extension that materializes memory mounts around each turn."""

    name = EXTENSION_NAME

    def __init__(self, actor: Any, client: MemoryStoreClient) -> None:
        self._actor = actor
        self._client = client
        self._specs = _specs_from_record(
            list(getattr(actor.record, "resources", []) or [])
        )
        self._mounts: list[MemoryMount] = []

    async def before_turn(self, bundle: Any) -> TurnContribution:
        if not self._specs:
            return TurnContribution()
        if not self._mounts:
            self._mounts = [
                MemoryMount(
                    spec=spec,
                    client=self._client,
                    tenant_id=self._actor.tenant_id,
                    session_id=self._actor.session_id,
                    workdir=bundle.workdir,
                )
                for spec in self._specs
            ]
        events: list[dict[str, Any]] = []
        try:
            for mount in self._mounts:
                if mount.writable:
                    events.extend(await mount.flush())
                events.extend(await mount.materialize())
        except MemoryServiceError as exc:
            if events:
                await self._actor.append(events)
            status = exc.status or "unavailable"
            raise TurnSetupError(
                "memory_mount_failed",
                f"memory store could not be mounted ({status})",
            ) from None
        return TurnContribution(
            hooks=[MemoryMountHook(self._actor, self._mounts, bundle.workdir)],
            system_prompt_suffix=_prompt(self._specs),
            events=events,
        )

    async def after_turn(self, bundle: Any) -> list[dict[str, Any]]:
        del bundle
        events: list[dict[str, Any]] = []
        for mount in self._mounts:
            if mount.writable:
                try:
                    events.extend(await mount.flush())
                except MemoryServiceError as exc:
                    note = f"status {exc.status}" if exc.status else "unavailable"
                    events.append(
                        session_error_event(
                            "memory_sync_failed",
                            f"memory store {mount.spec.name}: sync failed, {note}"[
                                :500
                            ],
                            "exhausted",
                        )
                    )
                continue
            if mount.detect_local_changes():
                events.append(
                    session_error_event(
                        "memory_read_only_violation",
                        (
                            f"memory store {mount.spec.name} is mounted read_only; "
                            "local changes were discarded and will be restored next turn"
                        ),
                        "exhausted",
                    )
                )
        return events

    async def close(self) -> None:
        self._mounts.clear()
        self._specs = []


def install_memory_mounts(state: Any, client: MemoryStoreClient) -> None:
    """Register the resources validator and the cloud memory extension."""
    state.service.register_create_validator(
        "resources", make_resources_validator(client)
    )

    async def factory(actor: Any) -> MemoryMountExtension | None:
        if getattr(actor.environment, "type", None) != "cloud":
            return None
        resources = list(getattr(actor.record, "resources", []) or [])
        if not any(
            isinstance(item, dict) and item.get("type") == "memory_store"
            for item in resources
        ):
            return None
        return MemoryMountExtension(actor, client)

    factory._ma_extension_name = EXTENSION_NAME  # type: ignore[attr-defined]
    state.service.register_extension_factory(factory)
    state.shutdown_hooks.append(client.aclose)


__all__ = [
    "EXTENSION_NAME",
    "MemoryMount",
    "MemoryMountExtension",
    "MemoryMountHook",
    "MountSpec",
    "install_memory_mounts",
    "make_resources_validator",
    "mount_name_for",
]
