#!/usr/bin/env python3
"""Smoke tests for sub-agent run review REST APIs.

Plan-Id: 2026-07-05-subagent-run-review-api

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from agenticx.cli.studio import StudioSession
from agenticx.runtime.subagent_runs import SubAgentRunStore
from agenticx.runtime.team_manager import AgentTeamManager
from agenticx.studio.server import create_studio_app
from agenticx.studio.subagent_review import (
    merge_run_record_with_memory,
    resolve_artifact_path,
)


class _QuickTextLLM:
    class _Resp:
        content = "done"
        tool_calls = []

    def invoke(self, *_args, **_kwargs):
        return self._Resp()

    def stream(self, *_args, **_kwargs):
        yield "ok"


async def _wait_until(predicate, timeout: float = 8.0) -> None:
    started = asyncio.get_running_loop().time()
    while not predicate():
        await asyncio.sleep(0.02)
        if (asyncio.get_running_loop().time() - started) > timeout:
            raise TimeoutError("condition not met in time")


@pytest.fixture()
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.delenv("AGX_DESKTOP_TOKEN", raising=False)
    app = create_studio_app()
    return TestClient(app)


def _seed_runs(tmp_path: Path) -> tuple[str, list[str]]:
    async def _run() -> tuple[str, list[str]]:
        owner_sid = "review-session-1"
        manager = AgentTeamManager(
            llm_factory=lambda: _QuickTextLLM(),
            base_session=StudioSession(),
            owner_session_id=owner_sid,
        )
        run_ids: list[str] = []
        for idx in range(3):
            result = await manager.spawn_subagent(
                name=f"Worker-{idx + 1}",
                role="worker",
                task=f"task-{idx + 1}",
                source_tool_call_id="tool-batch-review",
            )
            assert result["ok"] is True
            run_ids.append(result["agent_id"])
        await _wait_until(lambda: all(not manager._tasks.get(rid) for rid in run_ids))

        store = SubAgentRunStore(owner_sid)
        artifact_path = (
            tmp_path / ".agenticx" / "sessions" / owner_sid / "artifacts" / "report.md"
        )
        artifact_path.parent.mkdir(parents=True, exist_ok=True)
        artifact_path.write_text("# report\nhello artifact\n", encoding="utf-8")
        first = store.get_run(run_ids[0])
        assert first is not None
        store.close_run(
            run_ids[0],
            status="completed",
            result_summary="done",
            result_file=str(artifact_path),
            output_files=[str(artifact_path)],
            artifacts=[{"path": str(artifact_path), "kind": "file"}],
        )
        store.append_activity(
            run_ids[0],
            event_type="note",
            title="seed activity",
            detail="for review api test",
        )
        return owner_sid, run_ids

    return asyncio.run(_run())


def test_smoke_subagent_clusters_endpoint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, client: TestClient) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_sid, run_ids = _seed_runs(tmp_path)

    resp = client.get(
        "/api/session/subagent-clusters",
        params={"session_id": owner_sid},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ok") is True
    clusters = body.get("clusters") or []
    assert len(clusters) >= 1
    cluster = clusters[0]
    assert cluster.get("cluster_id")
    members = cluster.get("members") or []
    assert len(members) == 3
    member_ids = {item.get("run_id") for item in members}
    assert set(run_ids).issubset(member_ids)
    badge_seqs = sorted(item.get("badge_seq") for item in members if item.get("run_id") in run_ids)
    assert badge_seqs == ["01", "02", "03"]


def test_smoke_subagent_run_and_activity_pagination(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_sid, run_ids = _seed_runs(tmp_path)
    run_id = run_ids[0]

    detail = client.get(
        "/api/subagent/run",
        params={"session_id": owner_sid, "run_id": run_id},
    )
    assert detail.status_code == 200
    detail_body = detail.json()
    assert detail_body.get("ok") is True
    run_payload = detail_body.get("run") or {}
    assert run_payload.get("status") == "completed"
    assert int(run_payload.get("activity_count") or 0) >= 1
    assert run_payload.get("result_file")

    activity = client.get(
        "/api/subagent/run/activity",
        params={
            "session_id": owner_sid,
            "run_id": run_id,
            "offset": 0,
            "limit": 2,
            "order": "asc",
        },
    )
    assert activity.status_code == 200
    activity_body = activity.json()
    assert activity_body.get("ok") is True
    assert len(activity_body.get("entries") or []) <= 2
    assert activity_body.get("total", 0) >= 1

    empty_page = client.get(
        "/api/subagent/run/activity",
        params={
            "session_id": owner_sid,
            "run_id": run_id,
            "offset": 9999,
            "limit": 10,
        },
    )
    assert empty_page.status_code == 200
    assert empty_page.json().get("entries") == []


def test_smoke_subagent_artifact_preview_security(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_sid, run_ids = _seed_runs(tmp_path)
    run_id = run_ids[0]
    store = SubAgentRunStore(owner_sid)
    record = store.get_run(run_id)
    assert record is not None
    allowed_path = record.result_file
    assert allowed_path

    ok_preview = client.get(
        "/api/subagent/run/artifact-preview",
        params={"session_id": owner_sid, "run_id": run_id, "path": allowed_path},
    )
    assert ok_preview.status_code == 200
    ok_body = ok_preview.json()
    assert ok_body.get("ok") is True
    assert ok_body.get("kind") == "text"
    assert "hello artifact" in str(ok_body.get("text", ""))

    blocked = client.get(
        "/api/subagent/run/artifact-preview",
        params={
            "session_id": owner_sid,
            "run_id": run_id,
            "path": "../../../etc/passwd",
        },
    )
    assert blocked.status_code == 200
    blocked_body = blocked.json()
    assert blocked_body.get("ok") is False
    assert blocked_body.get("error") == "path not allowed"


def test_smoke_subagent_review_cold_restart(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_sid, run_ids = _seed_runs(tmp_path)

    # Simulate cold restart: new app instance, no in-memory team manager required.
    app = create_studio_app()
    cold_client = TestClient(app)

    clusters = cold_client.get(
        "/api/session/subagent-clusters",
        params={"session_id": owner_sid},
    ).json()
    assert clusters.get("ok") is True
    assert clusters.get("clusters")

    detail = cold_client.get(
        "/api/subagent/run",
        params={"session_id": owner_sid, "run_id": run_ids[1]},
    ).json()
    assert detail.get("ok") is True
    assert detail.get("run", {}).get("run_id") == run_ids[1]


def test_smoke_subagent_terminal_record_rejects_stale_running_memory(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_sid = "merge-session"
    store = SubAgentRunStore(owner_sid)
    record = store.open_run(
        run_id="agent-running-1",
        kind="spawn",
        name="Runner",
        role="worker",
        task="long task",
        status="completed",
        source_tool_call_id="tool-merge",
    )
    assert record.status == "completed"

    merged = merge_run_record_with_memory(
        store.get_run("agent-running-1"),  # type: ignore[arg-type]
        {
            "agent_id": "agent-running-1",
            "status": "running",
            "updated_at": record.updated_at + 10,
            "result_summary": "live progress",
            "recent_events": [{"type": "note", "title": "working"}],
        },
    )
    assert merged.get("status") == "completed"
    assert merged.get("result_summary") != "live progress"
    assert not merged.get("recent_events")


def test_smoke_subagent_empty_session_clusters(client: TestClient) -> None:
    resp = client.get(
        "/api/session/subagent-clusters",
        params={"session_id": "no-such-session"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body.get("ok") is True
    assert body.get("clusters") == []


def _create_api_session(client: TestClient) -> str:
    response = client.get("/api/session")
    assert response.status_code == 200
    return str(response.json()["session_id"])


def _seed_delegate_run(owner_session_id: str, run_id: str) -> None:
    SubAgentRunStore(owner_session_id).open_run(
        run_id=run_id,
        kind="delegate",
        name="Coder",
        role="Engineer",
        task="write report",
        status="completed",
        avatar_id="avatar-1",
        avatar_session_id="avatar-session-1",
    )


def test_subagents_status_includes_cold_start_delegate_from_ledger(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_id = _create_api_session(client)
    _seed_delegate_run(owner_id, "dlg-cold-api")

    body = client.get(
        "/api/subagents/status",
        params={"session_id": owner_id},
    ).json()

    assert body["ok"] is True
    assert [row["agent_id"] for row in body["subagents"]] == ["dlg-cold-api"]
    assert body["subagents"][0]["source"] == "ledger"


def test_subagents_status_deduplicates_live_delegate(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_id = _create_api_session(client)
    _seed_delegate_run(owner_id, "dlg-dedup-api")
    session_manager = client.app.state.session_manager
    session_manager._sessions["avatar-session-1"] = SimpleNamespace(
        archived=False,
        session_id="avatar-session-1",
        avatar_id="avatar-1",
        avatar_name="Coder",
        updated_at=9999999999.0,
        _delegation_info={
            "delegation_id": "dlg-dedup-api",
            "from_session": owner_id,
            "status": "running",
            "updated_at": 9999999999.0,
        },
    )

    body = client.get(
        "/api/subagents/status",
        params={"session_id": owner_id},
    ).json()

    assert [row["agent_id"] for row in body["subagents"]] == ["dlg-dedup-api"]


def test_subagents_status_keeps_owner_session_isolation(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_id = _create_api_session(client)
    other_id = _create_api_session(client)
    _seed_delegate_run(other_id, "dlg-other-api")

    body = client.get(
        "/api/subagents/status",
        params={"session_id": owner_id},
    ).json()

    assert body["subagents"] == []


def test_subagents_status_count_matches_unique_rows(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_id = _create_api_session(client)
    _seed_delegate_run(owner_id, "dlg-count-a")
    _seed_delegate_run(owner_id, "dlg-count-b")

    body = client.get(
        "/api/subagents/status",
        params={"session_id": owner_id},
    ).json()

    assert body["count"] == len(body["subagents"]) == 2


def test_subagents_status_reports_corrupt_index(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_id = _create_api_session(client)
    store = SubAgentRunStore(owner_id)
    store.root.mkdir(parents=True, exist_ok=True)
    (store.root / "index.json").write_text("{broken", encoding="utf-8")

    body = client.get(
        "/api/subagents/status",
        params={"session_id": owner_id},
    ).json()

    assert body["ok"] is False
    assert body["error"] == "subagent_run_store_read_failed"
    assert body["detail"] == "sub-agent run index is unreadable"
    assert str(store.root) not in str(body)


def test_subagents_status_reports_corrupt_record(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    client: TestClient,
) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    owner_id = _create_api_session(client)
    _seed_delegate_run(owner_id, "corrupt-record-api")
    store = SubAgentRunStore(owner_id)
    (store.root / "corrupt-record-api.json").write_text(
        "{broken",
        encoding="utf-8",
    )

    body = client.get(
        "/api/subagents/status",
        params={"session_id": owner_id},
    ).json()

    assert body["ok"] is False
    assert body["error"] == "subagent_run_store_read_failed"
    assert body["detail"] == "sub-agent run record is unreadable"
    assert str(store.root) not in str(body)


def test_resolve_artifact_path_rejects_non_whitelist(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    (tmp_path / "allowed.md").write_text("ok", encoding="utf-8")
    store = SubAgentRunStore("sid-1")
    record = store.open_run(
        run_id="r1",
        kind="spawn",
        name="A",
        role="worker",
        task="t",
        status="completed",
    )
    store.close_run(
        "r1",
        status="completed",
        result_file=str(tmp_path / "allowed.md"),
        output_files=[str(tmp_path / "allowed.md")],
    )
    record = store.get_run("r1")
    assert record is not None
    allowed, _, _ = resolve_artifact_path(
        requested_path=str(tmp_path / "allowed.md"),
        record=record,
        owner_session_id="sid-1",
    )
    assert allowed is True
    blocked, _, reason = resolve_artifact_path(
        requested_path=str(tmp_path / "secret.txt"),
        record=record,
        owner_session_id="sid-1",
    )
    assert blocked is False
    assert reason == "path not allowed"
