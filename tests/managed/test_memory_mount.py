#!/usr/bin/env python3
"""Mount names, materialize, flush, conflicts, and crash recovery.

Author: Damon Li
"""

from __future__ import annotations

import os
from pathlib import Path
from types import SimpleNamespace

import pytest

from agenticx.managed.host.config import Principal
from agenticx.managed.host.models import CreateSessionRequest
from agenticx.managed.memory import (
    InMemoryMemoryStoreClient,
    MemoryServiceError,
    MemoryWriteOp,
)
from agenticx.managed.memory_mount import (
    RETRY_DELAYS_SECONDS,
    MemoryMount,
    MemoryMountExtension,
    MountSpec,
    make_resources_validator,
    mount_name_for,
)

_TENANT = "dev"


def _spec(
    store_id: str, name: str, mount_name: str, access: str = "read_write"
) -> MountSpec:
    return MountSpec(
        store_id=store_id,
        name=name,
        access=access,
        instructions=None,
        mount_name=mount_name,
    )


def _mount(
    tmp_path: Path,
    client: InMemoryMemoryStoreClient,
    *,
    store_id: str,
    name: str,
    session_id: str,
    access: str = "read_write",
) -> tuple[MemoryMount, Path]:
    mount_name = mount_name_for(name, store_id)
    workdir = tmp_path / session_id / "work"
    workdir.mkdir(parents=True)
    mount = MemoryMount(
        spec=_spec(store_id, name, mount_name, access),
        client=client,
        tenant_id=_TENANT,
        session_id=session_id,
        workdir=workdir,
    )
    return mount, workdir


class _RecordingClient(InMemoryMemoryStoreClient):
    def __init__(self) -> None:
        super().__init__()
        self.calls: list[list[MemoryWriteOp]] = []
        self.failures = 0

    async def write(self, tenant_id: str, session_id: str, store_id: str, ops):
        self.calls.append(list(ops))
        if self.failures > 0:
            self.failures -= 1
            raise MemoryServiceError("temp", transient=True)
        return await super().write(tenant_id, session_id, store_id, ops)


def _types(events: list[dict]) -> list[str]:
    return [
        event["error"]["type"]
        for event in events
        if event.get("type") == "session.error"
    ]


def _messages(events: list[dict]) -> str:
    return "\n".join(
        event["error"]["message"]
        for event in events
        if event.get("type") == "session.error"
    )


async def test_mount_name_for() -> None:
    assert mount_name_for("项目知识", "01JSTOREAAAAAAAAAAAAAAAAAA") == "项目知识-aaaaaa"
    assert (
        mount_name_for("Team Glossary!", "01JSTOREBBBBBBBBBBBBBBBBBB")
        == "team-glossary-bbbbbb"
    )
    assert mount_name_for("///", "01JSTORExxxxxx") == "store-xxxxxx"
    client = InMemoryMemoryStoreClient()
    client.add_store("STORE01AAAAAA", "Same")
    client.add_store("STORE02AAAAAA", "Same")
    validator = make_resources_validator(client)
    created = await validator(
        Principal(_TENANT, "U", frozenset({"ma:memory:write"})),
        CreateSessionRequest(
            agent_id="demo",
            resources=[
                {"type": "memory_store", "memory_store_id": "STORE01AAAAAA"},
                {"type": "memory_store", "memory_store_id": "STORE02AAAAAA"},
            ],
        ),
        SimpleNamespace(type="cloud"),
    )
    assert created[0]["mount_name"] == "same-aaaaaa"
    assert created[1]["mount_name"] == "same-aaaaaa-2"


async def test_materialize_writes_and_prunes(tmp_path: Path) -> None:
    client = InMemoryMemoryStoreClient()
    client.add_store("STORE01", "Notes")
    client.mount(_TENANT, "sess", "STORE01", "read_write")
    client.put("STORE01", "/a.md", "alpha")
    client.put("STORE01", "/dir/b.md", "beta")
    mount, workdir = _mount(
        tmp_path, client, store_id="STORE01", name="Notes", session_id="sess"
    )
    mount.root.mkdir(parents=True)
    (mount.root / "x.md").write_text("extra", encoding="utf-8")
    await mount.materialize()
    assert (mount.root / "a.md").read_text(encoding="utf-8") == "alpha"
    assert (mount.root / "dir" / "b.md").read_text(encoding="utf-8") == "beta"
    assert not (mount.root / "x.md").exists()
    baseline = workdir.parent / "memory-baseline" / f"{mount.spec.mount_name}.json"
    assert baseline.is_file()
    assert workdir not in baseline.parents
    assert not any(path.name == "memory-baseline" for path in workdir.rglob("*"))

    readonly = InMemoryMemoryStoreClient()
    readonly.add_store("STORE02", "Glossary")
    readonly.mount(_TENANT, "ro", "STORE02", "read_only")
    readonly.put("STORE02", "/a.md", "locked")
    ro_mount, _workdir = _mount(
        tmp_path,
        readonly,
        store_id="STORE02",
        name="Glossary",
        session_id="ro",
        access="read_only",
    )
    await ro_mount.materialize()
    if os.geteuid() != 0:
        mode = (ro_mount.root / "a.md").stat().st_mode
        assert mode & 0o222 == 0


async def test_flush_create_update_delete(tmp_path: Path) -> None:
    client = _RecordingClient()
    client.add_store("STORE01", "Notes")
    client.mount(_TENANT, "sess", "STORE01", "read_write")
    client.put("STORE01", "/a.md", "alpha")
    client.put("STORE01", "/dir/b.md", "beta")
    mount, _workdir = _mount(
        tmp_path, client, store_id="STORE01", name="Notes", session_id="sess"
    )
    await mount.materialize()
    (mount.root / "c.md").write_text("gamma", encoding="utf-8")
    (mount.root / "a.md").write_text("alpha-2", encoding="utf-8")
    (mount.root / "dir" / "b.md").unlink()
    events = await mount.flush()
    assert events == []
    assert len(client.calls) == 1
    ops = {op.path: op for op in client.calls[0]}
    assert set(ops) == {"/c.md", "/a.md", "/dir/b.md"}
    assert ops["/c.md"].op == "create"
    assert ops["/a.md"].op == "update"
    assert ops["/a.md"].expected_version == 1
    assert ops["/dir/b.md"].op == "delete"
    assert ops["/dir/b.md"].expected_version == 1
    assert client.get("STORE01", "/c.md") is not None
    assert client.get("STORE01", "/c.md").content == "gamma"
    assert client.get("STORE01", "/a.md").content == "alpha-2"
    assert client.get("STORE01", "/dir/b.md") is None
    owned = [
        row for row in client.versions("STORE01") if row["source_session_id"] == "sess"
    ]
    assert {row["operation"] for row in owned} == {"created", "modified", "deleted"}
    assert len(owned) == 3
    await mount.flush()
    assert len(client.calls) == 1


async def test_flush_rejects_symlink_and_big_files(tmp_path: Path) -> None:
    client = _RecordingClient()
    client.add_store("STORE01", "Notes")
    client.mount(_TENANT, "sess", "STORE01", "read_write")
    mount, workdir = _mount(
        tmp_path, client, store_id="STORE01", name="Notes", session_id="sess"
    )
    await mount.materialize()
    outside = workdir.parent / "outside.txt"
    outside.write_text("secret-outside", encoding="utf-8")
    (mount.root / "link.md").symlink_to(outside)
    (mount.root / "big.md").write_bytes(b"a" * 102401)
    (mount.root / "bin.md").write_bytes(b"\xff\xfe")
    events = await mount.flush()
    assert client.calls == []
    assert _types(events) == ["memory_entry_rejected"] * 3
    assert "secret-outside" not in _messages(events)
    again = await mount.flush()
    assert again == []
    assert client.calls == []


async def test_conflicts(tmp_path: Path) -> None:
    same = InMemoryMemoryStoreClient()
    same.add_store("S", "Notes")
    same.mount(_TENANT, "same", "S", "read_write")
    same.put("S", "/a.md", "v1")
    mount, _workdir = _mount(
        tmp_path, same, store_id="S", name="Notes", session_id="same"
    )
    await mount.materialize()
    (mount.root / "a.md").write_text("NEXT", encoding="utf-8")
    same.put("S", "/a.md", "NEXT")
    events = await mount.flush()
    assert _types(events) == []
    assert mount._entries["/a.md"]["version"] == 2

    deleted = InMemoryMemoryStoreClient()
    deleted.add_store("S", "Notes")
    deleted.mount(_TENANT, "del", "S", "read_write")
    deleted.put("S", "/a.md", "A")
    del_mount, _workdir = _mount(
        tmp_path, deleted, store_id="S", name="Notes", session_id="del"
    )
    await del_mount.materialize()
    (del_mount.root / "a.md").unlink()
    deleted.put("S", "/a.md", "A2")
    events = await del_mount.flush()
    assert "deletion was not applied" in _messages(events)
    assert "memory_write_conflict" in _types(events)
    assert deleted.get("S", "/a.md").content == "A2"

    session_id = "01HZZZZZZZ1234ABCD"
    sid8 = session_id[-8:].lower()
    changed = InMemoryMemoryStoreClient()
    changed.add_store("S", "Notes")
    changed.mount(_TENANT, session_id, "S", "read_write")
    changed.put("S", "/a.md", "A")
    changed_mount, _workdir = _mount(
        tmp_path,
        changed,
        store_id="S",
        name="Notes",
        session_id=session_id,
    )
    await changed_mount.materialize()
    (changed_mount.root / "a.md").write_text("B2", encoding="utf-8")
    changed.put("S", "/a.md", "A2")
    occupied = f"/a.md.conflict-{sid8}"
    changed.put("S", occupied, "taken")
    events = await changed_mount.flush()
    conflict = f"/a.md.conflict-{sid8}-2"
    assert changed.get("S", "/a.md").content == "A2"
    assert changed.get("S", conflict).content == "B2"
    assert (changed_mount.root / conflict.lstrip("/")).read_text(
        encoding="utf-8"
    ) == "B2"
    assert conflict in _messages(events)
    assert "B2" not in _messages(events)

    rebuilt = InMemoryMemoryStoreClient()
    rebuilt.add_store("S", "Notes")
    rebuilt.mount(_TENANT, "rebuild", "S", "read_write")
    rebuilt.put("S", "/a.md", "A")
    rebuild_mount, _workdir = _mount(
        tmp_path,
        rebuilt,
        store_id="S",
        name="Notes",
        session_id="rebuild",
    )
    await rebuild_mount.materialize()
    current = rebuilt.get("S", "/a.md")
    assert current is not None
    (rebuild_mount.root / "a.md").write_text("rebuilt", encoding="utf-8")
    await rebuilt.write(
        _TENANT,
        "rebuild",
        "S",
        [
            MemoryWriteOp(
                "delete",
                "/a.md",
                memory_id=current.memory_id,
                expected_version=current.version,
            )
        ],
    )
    events = await rebuild_mount.flush()
    assert "memory_write_conflict" not in _types(events)
    assert rebuilt.get("S", "/a.md").content == "rebuilt"


async def test_transient_retry(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "agenticx.managed.memory_mount.RETRY_DELAYS_SECONDS",
        (0, 0, 0),
    )
    assert RETRY_DELAYS_SECONDS
    client = _RecordingClient()
    client.add_store("S", "Notes")
    client.mount(_TENANT, "sess", "S", "read_write")
    client.put("S", "/a.md", "v1")
    client.failures = 2
    mount, _workdir = _mount(
        tmp_path, client, store_id="S", name="Notes", session_id="sess"
    )
    await mount.materialize()
    (mount.root / "a.md").write_text("v2", encoding="utf-8")
    events = await mount.flush()
    assert "memory_sync_failed" not in _types(events)
    assert client.get("S", "/a.md").content == "v2"
    assert len(client.calls) == 3

    client.failures = 4
    (mount.root / "a.md").write_text("v3", encoding="utf-8")
    version_before = mount._entries["/a.md"]["version"]
    events = await mount.flush()
    assert "memory_sync_failed" in _types(events)
    assert mount._entries["/a.md"]["version"] == version_before
    assert client.get("S", "/a.md").content == "v2"
    failed_ops = client.calls[-1]
    events = await mount.flush()
    assert "memory_sync_failed" not in _types(events)
    assert client.calls[-1][0].path == failed_ops[0].path
    assert client.calls[-1][0].content == failed_ops[0].content == "v3"
    assert client.get("S", "/a.md").content == "v3"


async def test_leftover_changes_flushed_on_next_turn_start(tmp_path: Path) -> None:
    client = InMemoryMemoryStoreClient()
    client.add_store("S", "Notes")
    session_id = "01SESSIONABCDEFGH123456"
    client.mount(_TENANT, session_id, "S", "read_write")
    client.put("S", "/a.md", "A")
    mount_name = mount_name_for("Notes", "S")
    actor = SimpleNamespace(
        tenant_id=_TENANT,
        session_id=session_id,
        record=SimpleNamespace(
            resources=[
                {
                    "type": "memory_store",
                    "memory_store_id": "S",
                    "access": "read_write",
                    "instructions": None,
                    "name": "Notes",
                    "mount_name": mount_name,
                    "mount_path": f"memory/{mount_name}",
                }
            ]
        ),
    )
    workdir = tmp_path / "work"
    workdir.mkdir()
    bundle = SimpleNamespace(workdir=workdir)
    first = MemoryMountExtension(actor, client)
    await first.before_turn(bundle)
    created = workdir / "memory" / mount_name / "new.md"
    created.parent.mkdir(parents=True, exist_ok=True)
    created.write_text("kept", encoding="utf-8")
    restarted = MemoryMountExtension(actor, client)
    await restarted.before_turn(bundle)
    assert client.get("S", "/new.md") is not None
    assert client.get("S", "/new.md").content == "kept"
    assert created.read_text(encoding="utf-8") == "kept"
