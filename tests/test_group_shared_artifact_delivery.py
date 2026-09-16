#!/usr/bin/env python3
"""Smoke tests: group shared workspace and structured artifact delivery.

Author: Damon Li
"""

from __future__ import annotations

import time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from agenticx.cli.studio import StudioSession
from agenticx.runtime.events import EventType
from agenticx.runtime.group_context import GroupChatContext
from agenticx.runtime.group_facts import (
    GROUP_INTERNAL_FILENAMES,
    ArtifactFingerprint,
    changed_artifact_paths,
    collect_artifact_paths,
    scan_artifact_snapshot,
)
from agenticx.runtime.group_router import (
    GroupArtifact,
    GroupChatRouter,
    GroupReply,
    _group_artifacts_from_paths,
)
from agenticx.studio.session_manager import ManagedSession, SessionManager
from agenticx.workspace.loader import ensure_group_workspace

TINY_PNG = (
    "data:image/png;base64,"
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=="
)


def _patch_agenticx_home(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    home = tmp_path / ".agenticx"
    home.mkdir()
    monkeypatch.setattr("agenticx.workspace.loader.DEFAULT_AGENTICX_HOME", home)
    return home


# ---------------------------------------------------------------------------
# FR-1: group session binds shared workspace
# ---------------------------------------------------------------------------

def test_same_group_sessions_share_workspace(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    home = _patch_agenticx_home(monkeypatch, tmp_path)
    monkeypatch.setenv("HOME", str(tmp_path))
    manager = SessionManager()
    manager._taskspaces_root = str(tmp_path / "taskspaces")
    a = ManagedSession(session_id="sid-a", studio_session=StudioSession(), avatar_id="group:g1")
    b = ManagedSession(session_id="sid-b", studio_session=StudioSession(), avatar_id="group:g1")
    manager.apply_session_workspace_dir(a)
    manager.apply_session_workspace_dir(b)
    expected = str((home / "groups" / "g1" / "workspace").resolve())
    assert a.studio_session.workspace_dir == expected
    assert b.studio_session.workspace_dir == expected
    assert a.studio_session.workspace_dir == b.studio_session.workspace_dir
    manager._ensure_default_taskspace(a)
    assert any(t.get("id") == "default" and t.get("path") == expected for t in a.taskspaces)


def test_meta_and_avatar_workspace_unchanged(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    manager = SessionManager()
    manager._taskspaces_root = str(tmp_path / "taskspaces")
    meta = ManagedSession(session_id="sid-meta", studio_session=StudioSession())
    manager.apply_session_workspace_dir(meta)
    expected_meta = str((tmp_path / "taskspaces" / "sid-meta" / "default").resolve())
    assert meta.studio_session.workspace_dir == expected_meta

    avatar_ws = tmp_path / "avatar-ws"
    avatar_ws.mkdir()
    avatar = ManagedSession(
        session_id="sid-avatar",
        studio_session=StudioSession(),
        avatar_id="coder",
    )
    manager.apply_session_workspace_dir(avatar, avatar_workspace_dir=str(avatar_ws))
    assert Path(avatar.studio_session.workspace_dir).resolve() == avatar_ws.resolve()

    auto = ManagedSession(
        session_id="sid-auto",
        studio_session=StudioSession(),
        avatar_id="automation:task-1",
    )
    before = auto.studio_session.workspace_dir
    manager.apply_session_workspace_dir(auto)
    assert auto.studio_session.workspace_dir != str(tmp_path / "groups")
    assert not str(auto.studio_session.workspace_dir).endswith("/groups/task-1/workspace")
    assert auto.studio_session.workspace_dir != before or auto.studio_session.workspace_dir


def test_align_meta_does_not_override_group_session(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    home = _patch_agenticx_home(monkeypatch, tmp_path)
    monkeypatch.setenv("HOME", str(tmp_path))
    manager = SessionManager()
    manager._taskspaces_root = str(tmp_path / "taskspaces")
    managed = ManagedSession(
        session_id="sid-group",
        studio_session=StudioSession(),
        avatar_id="group:g1",
    )
    manager.apply_session_workspace_dir(managed)
    expected = str((home / "groups" / "g1" / "workspace").resolve())
    manager.align_meta_session_workspace(managed)
    assert managed.studio_session.workspace_dir == expected


# ---------------------------------------------------------------------------
# FR-2: fingerprint + filter
# ---------------------------------------------------------------------------

def test_scan_detects_new_and_modified_files(tmp_path: Path) -> None:
    root = tmp_path / "ws"
    root.mkdir()
    kept = root / "keep.txt"
    kept.write_text("old", encoding="utf-8")
    time.sleep(0.01)
    before = scan_artifact_snapshot([{"path": str(root)}])
    new_file = root / "plan.md"
    new_file.write_text("# plan", encoding="utf-8")
    kept.write_text("new", encoding="utf-8")
    after = scan_artifact_snapshot([{"path": str(root)}])
    changed = changed_artifact_paths(before, after)
    assert str(new_file) in changed
    assert str(kept) in changed
    unchanged = root / "keep.txt"
    after_same = scan_artifact_snapshot([{"path": str(root)}])
    assert changed_artifact_paths(after, after_same) == []
    deleted = root / "gone.txt"
    deleted.write_text("x", encoding="utf-8")
    mid = scan_artifact_snapshot([{"path": str(root)}])
    deleted.unlink()
    after_del = scan_artifact_snapshot([{"path": str(root)}])
    assert str(deleted) not in changed_artifact_paths(mid, after_del)
    assert unchanged.exists()


def test_scan_skips_memory_internal_symlink_and_caps(tmp_path: Path) -> None:
    root = tmp_path / "ws"
    root.mkdir()
    (root / "IDENTITY.md").write_text("id", encoding="utf-8")
    (root / "MEMORY.md").write_text("mem", encoding="utf-8")
    (root / "memory").mkdir()
    (root / "memory" / "note.md").write_text("n", encoding="utf-8")
    (root / "node_modules").mkdir()
    (root / "node_modules" / "pkg.js").write_text("p", encoding="utf-8")
    (root / ".git").mkdir()
    (root / ".git" / "HEAD").write_text("ref", encoding="utf-8")
    (root / "docs").mkdir()
    nested_memory = root / "docs" / "MEMORY.md"
    nested_memory.write_text("keep", encoding="utf-8")
    real = root / "real.md"
    real.write_text("ok", encoding="utf-8")
    link = root / "link.md"
    link.symlink_to(real)
    for i in range(12):
        (root / f"out-{i:02d}.txt").write_text(str(i), encoding="utf-8")
        time.sleep(0.002)
    snap = scan_artifact_snapshot([{"path": str(root)}])
    paths = set(snap)
    assert str(nested_memory) in paths
    assert str(real) in paths
    assert str(link) not in paths
    assert str(root / "IDENTITY.md") not in paths
    assert str(root / "MEMORY.md") not in paths
    assert str(root / "memory" / "note.md") not in paths
    assert str(root / "node_modules" / "pkg.js") not in paths
    before: dict[str, ArtifactFingerprint] = {}
    changed = changed_artifact_paths(before, snap, limit=8)
    assert len(changed) == 8
    assert changed == sorted(changed, key=lambda p: (-snap[p].mtime_ns, p))
    collected = collect_artifact_paths([{"path": str(root)}])
    assert str(root / "IDENTITY.md") not in collected
    assert str(nested_memory) in collected
    assert GROUP_INTERNAL_FILENAMES


# ---------------------------------------------------------------------------
# FR-3 / FR-4: GroupReply artifacts + history attachments
# ---------------------------------------------------------------------------

def _make_router() -> GroupChatRouter:
    avatar = MagicMock()
    avatar.name = "a1"
    avatar.role = "专家"
    avatar.system_prompt = ""
    avatar.avatar_url = ""
    avatar.default_provider = ""
    avatar.default_model = ""
    registry = MagicMock()
    registry.get_avatar = MagicMock(return_value=avatar)
    return GroupChatRouter(
        avatar_registry=registry,
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=3,
    )


def _session_with_workspace(root: Path) -> MagicMock:
    sess = MagicMock()
    sess.session_id = "art-session"
    sess._session_id = "art-session"
    sess.provider_name = "openai"
    sess.model_name = "gpt-4"
    sess.workspace_dir = str(root)
    sess.context_files = {}
    sess.taskspaces = [{"id": "default", "path": str(root)}]
    sess.scratchpad = {}
    sess.chat_history = []
    sess.__group_avatar_ids = ["a1"]
    return sess


@pytest.mark.asyncio
async def test_run_one_target_attaches_new_and_modified_files(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "ws"
    root.mkdir()
    existing = root / "old.md"
    existing.write_text("v1", encoding="utf-8")

    class _WriterRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            (root / "a.md").write_text("A", encoding="utf-8")
            (root / "b.md").write_text("B", encoding="utf-8")
            existing.write_text("v2", encoding="utf-8")
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "方案已写入。"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _WriterRuntime)
    router = _make_router()
    session = _session_with_workspace(root)
    context = GroupChatContext(session)
    reply = await router._run_one_target(
        base_session=session,
        context=context,
        group_id="g1",
        group_name="Room",
        avatar_id="a1",
        user_input="写一份方案",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    names = {item.name for item in reply.artifacts}
    assert names == {"a.md", "b.md", "old.md"}
    assert all(item.source_path for item in reply.artifacts)
    row = session.chat_history[-1]
    assert row["attachments"]
    assert {item["name"] for item in row["attachments"]} == names
    assert all(item["reference_token"] is True for item in row["attachments"])
    assert all(item["kind"] == "context_file" for item in row["attachments"])


@pytest.mark.asyncio
async def test_skipped_and_error_have_no_artifacts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "ws"
    root.mkdir()

    class _SkipRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            (root / "half.md").write_text("draft", encoding="utf-8")
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "__SKIP__"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _SkipRuntime)
    router = _make_router()
    session = _session_with_workspace(root)
    reply = await router._run_one_target(
        base_session=session,
        context=context if (context := GroupChatContext(session)) else GroupChatContext(session),
        group_id="g1",
        group_name="Room",
        avatar_id="a1",
        user_input="闲聊",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=False,
    )
    assert reply.skipped is True
    assert reply.artifacts == []
    assert (root / "half.md").is_file()


@pytest.mark.asyncio
async def test_no_new_files_yields_empty_artifacts(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    root = tmp_path / "ws"
    root.mkdir()
    (root / "keep.md").write_text("same", encoding="utf-8")

    class _TalkRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "没有新文件。"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _TalkRuntime)
    router = _make_router()
    session = _session_with_workspace(root)
    reply = await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g1",
        group_name="Room",
        avatar_id="a1",
        user_input="解释一下",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    assert reply.artifacts == []


def test_group_artifacts_from_paths_skips_missing(tmp_path: Path) -> None:
    real = tmp_path / "ok.md"
    real.write_text("x", encoding="utf-8")
    items = _group_artifacts_from_paths([str(real), str(tmp_path / "missing.md")])
    assert len(items) == 1
    assert items[0].name == "ok.md"
    assert items[0].mime_type


def test_append_agent_attachments_match_session_schema() -> None:
    session = SimpleNamespace(chat_history=[], scratchpad={})
    context = GroupChatContext(session)
    context.append_agent(
        agent_id="a1",
        agent_name="专家",
        text="结论",
        attachments=[
            {
                "name": "plan.md",
                "mime_type": "text/markdown",
                "size": 12,
                "source_path": "/tmp/plan.md",
                "reference_token": True,
                "kind": "context_file",
            }
        ],
    )
    assert session.chat_history[-1]["attachments"][0]["source_path"] == "/tmp/plan.md"
    context.append_agent(agent_id="a1", agent_name="专家", text="无附件")
    assert "attachments" not in session.chat_history[-1]


def test_append_user_persists_image_attachments() -> None:
    session = SimpleNamespace(chat_history=[], scratchpad={})
    context = GroupChatContext(session)
    context.append_user(
        "看这张图",
        attachments=[
            {
                "name": "image.png",
                "mime_type": "image/png",
                "size": 12,
                "data_url": TINY_PNG,
            }
        ],
    )
    assert session.chat_history[-1]["attachments"][0]["data_url"].startswith("data:image/")
    assert session.chat_history[-1]["attachments"][0]["name"] == "image.png"
    context.append_user("纯文字")
    assert "attachments" not in session.chat_history[-1]


def test_sse_payload_includes_artifacts() -> None:
    reply = GroupReply(
        agent_id="a1",
        avatar_name="专家",
        avatar_url="",
        content="结论",
        artifacts=[
            GroupArtifact(
                name="plan.md",
                source_path="/tmp/plan.md",
                mime_type="text/markdown",
                size=12,
            )
        ],
    )
    payload = {
        "artifacts": [
            {
                "name": item.name,
                "mime_type": item.mime_type,
                "size": item.size,
                "source_path": item.source_path,
                "reference_token": True,
            }
            for item in (getattr(reply, "artifacts", None) or [])
        ],
    }
    assert payload["artifacts"][0]["source_path"] == "/tmp/plan.md"


@pytest.mark.asyncio
async def test_member_prompt_mentions_shared_workspace(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: list[str] = []

    class _CapturingRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            captured.append(str(kwargs.get("system_prompt") or ""))
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "短结论。"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _CapturingRuntime)
    router = _make_router()
    root = tmp_path / "ws"
    root.mkdir()
    session = _session_with_workspace(root)
    await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g1",
        group_name="Room",
        avatar_id="a1",
        user_input="写方案",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    assert captured
    assert "群共享工作区" in captured[0]
    assert str(root) in captured[0]
    assert "不要伪造路径" in captured[0]


@pytest.mark.asyncio
async def test_run_one_target_forwards_vision_blocks_and_attachments(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class _CapturingRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            captured.update(kwargs)
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "看到图了。"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _CapturingRuntime)
    router = _make_router()
    root = tmp_path / "ws"
    root.mkdir()
    session = _session_with_workspace(root)
    session.provider_name = "openai"
    session.model_name = "gpt-4o"
    session.scratchpad = {
        "__group_turn_image_inputs__": [
            {"name": "image.png", "data_url": TINY_PNG, "mime_type": "image/png", "size": 70}
        ],
        "__group_turn_history_attachments__": [
            {"name": "image.png", "mime_type": "image/png", "size": 70, "data_url": TINY_PNG}
        ],
    }
    await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g1",
        group_name="Room",
        avatar_id="a1",
        user_input="看图",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    content = captured.get("user_message_content")
    assert isinstance(content, list)
    assert content[0]["type"] == "text"
    assert content[0]["text"] == "看图"
    image_blocks = [block for block in content if block.get("type") == "image_url"]
    assert image_blocks
    assert image_blocks[0]["image_url"]["url"] == TINY_PNG
    history = captured.get("history_user_attachments")
    assert isinstance(history, list)
    assert history[0]["data_url"] == TINY_PNG


@pytest.mark.asyncio
async def test_run_one_target_non_vision_member_skips_image_blocks(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, object] = {}

    class _CapturingRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            captured.update(kwargs)
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "纯文本。"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _CapturingRuntime)
    router = _make_router()
    router.avatar_registry.get_avatar.return_value.default_model = "glm-5"
    root = tmp_path / "ws"
    root.mkdir()
    session = _session_with_workspace(root)
    session.scratchpad = {
        "__group_turn_image_inputs__": [
            {"name": "image.png", "data_url": TINY_PNG, "mime_type": "image/png", "size": 70}
        ],
        "__group_turn_history_attachments__": [
            {"name": "image.png", "mime_type": "image/png", "size": 70, "data_url": TINY_PNG}
        ],
    }
    await router._run_one_target(
        base_session=session,
        context=GroupChatContext(session),
        group_id="g1",
        group_name="Room",
        avatar_id="a1",
        user_input="看图",
        quoted_content="",
        should_stop=lambda: False,
        force_reply=True,
    )
    assert captured.get("user_message_content") is None
    history = captured.get("history_user_attachments")
    assert isinstance(history, list)
    assert history[0]["data_url"] == TINY_PNG


@pytest.mark.asyncio
async def test_run_group_turn_persists_user_image_attachments(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class _CapturingRuntime:
        def __init__(self, *args, **kwargs) -> None:
            pass

        async def run_turn(self, *args, **kwargs):
            yield SimpleNamespace(type=EventType.FINAL.value, data={"text": "看到图了。"})

    monkeypatch.setattr("agenticx.runtime.group_router.AgentRuntime", _CapturingRuntime)
    router = _make_router()
    root = tmp_path / "ws"
    root.mkdir()
    session = _session_with_workspace(root)
    session.provider_name = "openai"
    session.model_name = "gpt-4o"
    image = {
        "name": "image.png",
        "data_url": TINY_PNG,
        "mime_type": "image/png",
        "size": 70,
    }
    history = {
        "name": "image.png",
        "mime_type": "image/png",
        "size": 70,
        "data_url": TINY_PNG,
    }
    async for _ in router.run_group_turn(
        base_session=session,
        group_id="g1",
        group_name="Room",
        routing="user-directed",
        group_avatar_ids=["a1"],
        mentioned_avatar_ids=["a1"],
        user_input="看图",
        quoted_content="",
        should_stop=lambda: False,
        image_inputs=[image],
        history_image_attachments=[history],
    ):
        pass
    user_rows = [row for row in session.chat_history if row.get("role") == "user"]
    assert user_rows
    assert user_rows[0]["attachments"][0]["data_url"] == TINY_PNG
    assert "__group_turn_image_inputs__" not in session.scratchpad
    assert "__group_turn_history_attachments__" not in session.scratchpad


def test_ensure_group_workspace_is_stable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    _patch_agenticx_home(monkeypatch, tmp_path)
    first = ensure_group_workspace("g1")
    second = ensure_group_workspace("g1")
    assert first == second
    assert first.is_dir()
