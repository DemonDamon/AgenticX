"""Near-orchestrated CodeBuddy CLI subagents from Claude Code asks."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from agenticx.harness.claude_code_cb_subagents import (
    cancel_codebuddy_subagent_run,
    format_cb_subagent_result_text,
    maybe_run_cb_subagents_for_claude_code_turn,
    plan_codebuddy_subagent_tasks,
    run_codebuddy_subagents,
    _track_cb_run,
    _untrack_cb_run,
)
from agenticx.harness.types import TURN_STATUS_SUCCESS, TurnResult


def test_plan_splits_two_report_topics(tmp_path: Path):
    text = "你能用 codebuddy 来作为 subagents，写两份关于后续的美国党派和中国关系的推演预测报告"
    tasks = plan_codebuddy_subagent_tasks(text, cwd=str(tmp_path))
    assert len(tasks) == 2
    joined = " ".join(t.prompt for t in tasks)
    assert "美国党派" in joined or "党派" in tasks[0].name or "党派" in tasks[0].prompt
    assert "中国关系" in joined or "中国" in tasks[1].prompt
    assert all(t.output_path.endswith(".md") for t in tasks)


def test_plan_default_two_when_subagents_plural(tmp_path: Path):
    text = "用 CodeBuddy 做两个 subagent 一起调研这个仓库的 README"
    tasks = plan_codebuddy_subagent_tasks(text, cwd=str(tmp_path))
    assert len(tasks) == 2


def test_format_unavailable():
    text = format_cb_subagent_result_text({"error": "codebuddy_unavailable", "results": []})
    assert "codebuddy" in text.lower()
    assert "无法跨引擎" in text


def test_maybe_run_returns_none_without_cb_ask(tmp_path: Path):
    assert (
        maybe_run_cb_subagents_for_claude_code_turn(
            parent_session_id="s1",
            user_text="写一份普通总结",
            cwd=str(tmp_path),
            wait_seconds=1.0,
        )
        is None
    )


def test_maybe_run_orchestrates_when_asked(tmp_path: Path):
    fake_payload = {
        "ok": True,
        "error": None,
        "results": [
            {
                "name": "codebuddy-1",
                "ok": True,
                "status": "success",
                "result_text": "摘要A",
                "output_path": str(tmp_path / "a.md"),
                "wrote_output": True,
            }
        ],
        "task_count": 1,
    }
    with patch(
        "agenticx.harness.claude_code_cb_subagents.run_codebuddy_subagents",
        return_value=fake_payload,
    ) as mocked:
        result = maybe_run_cb_subagents_for_claude_code_turn(
            parent_session_id="s1",
            user_text="用 CodeBuddy 做 subagent 写报告",
            cwd=str(tmp_path),
            wait_seconds=5.0,
        )
    assert result is not None
    assert result.status == TURN_STATUS_SUCCESS
    assert result.harness == "claude-code"
    assert "CodeBuddy CLI" in result.result_text
    assert result.detail.get("child_harness") == "codebuddy"
    mocked.assert_called_once()
    assert mocked.call_args.kwargs.get("parent_session_id") == "s1"


def test_run_registers_subagent_run_store(tmp_path: Path, monkeypatch):
    """Each CB child open_run/close_run under the Near studio owner session id."""
    report = tmp_path / "report_cb_subagent_1.md"
    report.write_text("# ok\n", encoding="utf-8")

    class _FakeAdapter:
        def available(self):
            return True

        def spawn(self, cwd, options=None):
            return {"session_id": "cb-cli-sess-1"}

        def turn(self, session_id, request):
            return TurnResult(
                harness="codebuddy",
                session_id=session_id,
                status=TURN_STATUS_SUCCESS,
                result_text="摘要完成",
            )

        def stop(self, session_id):
            return None

    store = MagicMock()
    store.open_run.return_value = MagicMock(cluster_id="cl-1", badge_seq="01")
    store.close_run.return_value = MagicMock()
    store.append_activity.return_value = MagicMock()

    monkeypatch.setattr(
        "agenticx.harness.claude_code_cb_subagents.codebuddy_cli_available",
        lambda: True,
    )
    with patch(
        "agenticx.harness.adapters.codebuddy.CodeBuddyAdapter",
        _FakeAdapter,
    ), patch(
        "agenticx.runtime.subagent_runs.SubAgentRunStore",
        return_value=store,
    ) as store_cls:
        payload = run_codebuddy_subagents(
            "用 CodeBuddy 做 subagent 写一份报告",
            cwd=str(tmp_path),
            wait_seconds=1.0,
            parent_session_id="owner-cb-session",
        )

    assert payload["ok"] is True
    assert payload["parent_session_id"] == "owner-cb-session"
    assert store_cls.call_count >= 2  # open + close (activity uses same instance)
    # open_run under parent session
    open_calls = [c for c in store.open_run.call_args_list]
    assert open_calls, "expected open_run"
    open_kwargs = open_calls[0].kwargs
    assert open_kwargs["kind"] == "codebuddy"
    assert open_kwargs["provider"] == "codebuddy"
    assert open_kwargs["status"] == "running"
    assert "CodeBuddy CLI" in open_kwargs["role"]
    assert open_kwargs["name"].startswith("codebuddy")
    assert store_cls.call_args_list[0].args[0] == "owner-cb-session"

    close_calls = store.close_run.call_args_list
    assert close_calls, "expected close_run"
    close_args, close_kwargs = close_calls[0].args, close_calls[0].kwargs
    assert close_args[0].startswith("cb-subagent-")
    assert close_kwargs["status"] == "completed"
    assert close_kwargs["result_file"].endswith("report_cb_subagent_1.md")
    assert any(
        str(p).endswith("report_cb_subagent_1.md")
        for p in (close_kwargs.get("output_files") or [])
    )

    # every SubAgentRunStore constructed with parent session id
    for call in store_cls.call_args_list:
        assert call.args[0] == "owner-cb-session"

def test_run_registers_under_studio_owner_not_surface(tmp_path: Path, monkeypatch):
    """WorkPanel queries studio session; surface_sid must not own the store."""
    report = tmp_path / "report_cb_subagent_1.md"
    report.write_text("# ok\n", encoding="utf-8")

    class _FakeAdapter:
        def available(self):
            return True

        def spawn(self, cwd, options=None):
            return {"session_id": "cb-cli-sess-1"}

        def turn(self, session_id, request):
            return TurnResult(
                harness="codebuddy",
                session_id=session_id,
                status=TURN_STATUS_SUCCESS,
                result_text="摘要完成",
            )

        def stop(self, session_id):
            return None

    store = MagicMock()
    store.open_run.return_value = MagicMock(
        cluster_id="cl-studio-1",
        badge_seq="01",
        created_at=123.0,
    )
    store.close_run.return_value = MagicMock()
    store.append_activity.return_value = MagicMock()

    monkeypatch.setattr(
        "agenticx.harness.claude_code_cb_subagents.codebuddy_cli_available",
        lambda: True,
    )
    with patch(
        "agenticx.harness.adapters.codebuddy.CodeBuddyAdapter",
        _FakeAdapter,
    ), patch(
        "agenticx.runtime.subagent_runs.SubAgentRunStore",
        return_value=store,
    ) as store_cls:
        payload = run_codebuddy_subagents(
            "用 CodeBuddy 做两个 subagent 写报告",
            cwd=str(tmp_path),
            wait_seconds=1.0,
            parent_session_id="studio-near-894e",
        )

    assert payload["ok"] is True
    assert payload["parent_session_id"] == "studio-near-894e"
    assert payload["cluster_id"] == "cl-studio-1"
    assert payload["cluster_title"].startswith("Agent 蜂群")
    assert "并行任务" in payload["cluster_title"]
    assert len(payload["run_ids"]) >= 1
    for call in store_cls.call_args_list:
        assert call.args[0] == "studio-near-894e"
        assert call.args[0] != "surface-cc-87a2"


def test_maybe_run_uses_studio_owner_session_id(tmp_path: Path):
    fake_payload = {
        "ok": True,
        "error": None,
        "results": [
            {
                "name": "codebuddy-1",
                "run_id": "cb-subagent-x-1",
                "ok": True,
                "status": "success",
                "result_text": "摘要A",
                "output_path": str(tmp_path / "a.md"),
                "wrote_output": True,
                "cluster_id": "cl-1",
            }
        ],
        "task_count": 1,
        "cluster_id": "cl-1",
        "cluster_title": "Agent 蜂群 · 1 个并行任务",
        "run_ids": ["cb-subagent-x-1"],
        "parent_session_id": "studio-sid",
    }
    with patch(
        "agenticx.harness.claude_code_cb_subagents.run_codebuddy_subagents",
        return_value=fake_payload,
    ) as mocked:
        result = maybe_run_cb_subagents_for_claude_code_turn(
            parent_session_id="studio-sid",
            user_text="用 CodeBuddy 做 subagent 写报告",
            cwd=str(tmp_path),
            wait_seconds=5.0,
        )
    assert result is not None
    assert mocked.call_args.kwargs.get("parent_session_id") == "studio-sid"
    assert result.detail["near_cb_subagents"]["cluster_id"] == "cl-1"
    assert result.detail["near_cb_subagents"]["parent_session_id"] == "studio-sid"


def test_claude_code_adapter_prefers_turn_owner_session_id(tmp_path: Path):
    """adapter.turn(surface_sid) must register under request.owner_session_id."""
    from agenticx.harness.adapters.claude_code import ClaudeCodeAdapter
    from agenticx.harness.types import TurnRequest

    adapter = ClaudeCodeAdapter.__new__(ClaudeCodeAdapter)
    fake_session = MagicMock()
    fake_session.cwd = str(tmp_path)
    fake_session.model = None
    adapter.get = lambda sid: fake_session

    captured = {}

    def _fake_maybe(**kwargs):
        captured.update(kwargs)
        return TurnResult(
            harness="claude-code",
            session_id=kwargs["parent_session_id"],
            status=TURN_STATUS_SUCCESS,
            result_text="ok",
            detail={"near_cb_subagents": {"parent_session_id": kwargs["parent_session_id"]}},
        )

    with patch(
        "agenticx.harness.adapters.claude_code.maybe_run_cb_subagents_for_claude_code_turn",
        side_effect=_fake_maybe,
    ):
        result = ClaudeCodeAdapter.turn(
            adapter,
            "surface-cc-87a2",
            TurnRequest(
                text="用 CodeBuddy 做 subagent 写两份报告",
                wait_seconds=1.0,
                owner_session_id="studio-near-894e",
                studio_session_id="studio-near-894e",
            ),
        )
    assert captured["parent_session_id"] == "studio-near-894e"
    assert result.detail["near_cb_subagents"]["parent_session_id"] == "studio-near-894e"


def test_harness_wiring_sets_owner_and_appends_cluster_anchor(tmp_path: Path, monkeypatch):
    """run_external_harness_turn passes studio sid and persists Agent 蜂群 anchor."""
    from types import SimpleNamespace
    from agenticx.studio import harness_wiring as hw
    from agenticx.harness.types import TurnRequest, TurnResult

    studio_sid = "studio-near-894e"
    surface_sid = "surface-cc-87a2"

    history: list = []
    session = SimpleNamespace(chat_history=history, model_name="")
    managed = SimpleNamespace(studio_session=session, updated_at=0.0)
    manager = MagicMock()
    manager.get.return_value = managed
    manager.get_session_harness.return_value = {
        "harness_id": "claude-code",
        "harness_session_id": surface_sid,
        "harness_options": {},
    }

    captured_request = {}

    class _FakeAdapter:
        def turn(self, session_id, request: TurnRequest):
            captured_request["surface"] = session_id
            captured_request["owner"] = request.owner_session_id
            captured_request["studio"] = request.studio_session_id
            return TurnResult(
                harness="claude-code",
                session_id=session_id,
                status=TURN_STATUS_SUCCESS,
                result_text="done",
                detail={
                    "near_cb_subagents": {
                        "ok": True,
                        "parent_session_id": request.owner_session_id,
                        "cluster_id": "cl-anchor-1",
                        "cluster_title": "Agent 蜂群 · 2 个并行任务",
                        "cluster_created_at": 42.0,
                        "batch_source_id": "near-cb-batch",
                        "run_ids": ["cb-subagent-a-1", "cb-subagent-a-2"],
                        "results": [
                            {"run_id": "cb-subagent-a-1", "ok": True, "name": "codebuddy-1"},
                            {"run_id": "cb-subagent-a-2", "ok": True, "name": "codebuddy-2"},
                        ],
                    }
                },
            )

    monkeypatch.setattr(hw, "require_safe_session_id", lambda sid: sid)
    monkeypatch.setattr(hw, "is_external_harness", lambda hid: True)
    monkeypatch.setattr(hw, "apply_chat_model_to_harness_options", lambda *a, **k: None)
    monkeypatch.setattr(hw, "apply_run_mode_to_harness_options", lambda *a, **k: None)
    monkeypatch.setattr(hw, "ensure_harness_session", lambda *a, **k: surface_sid)
    monkeypatch.setattr(hw, "harness_registry", lambda: SimpleNamespace(require=lambda hid: _FakeAdapter()))
    monkeypatch.setattr(hw, "_begin_inflight", lambda sid: True)
    monkeypatch.setattr(hw, "_end_inflight", lambda sid: None)
    monkeypatch.setattr(
        hw,
        "format_external_harness_assistant_content",
        lambda hid, result: result.result_text or "",
    )

    result = hw.run_external_harness_turn(
        manager,
        studio_sid,
        "用 CodeBuddy 做 subagent 写两份报告",
    )
    assert captured_request["surface"] == surface_sid
    assert captured_request["owner"] == studio_sid
    assert captured_request["studio"] == studio_sid
    assert result.detail["near_cb_subagents"]["parent_session_id"] == studio_sid

    anchors = [
        row
        for row in history
        if isinstance(row, dict)
        and isinstance(row.get("metadata"), dict)
        and isinstance(row["metadata"].get("subagent_cluster"), dict)
    ]
    assert anchors, "expected persisted Agent 蜂群 chat_history anchor"
    anchor = anchors[0]["metadata"]["subagent_cluster"]
    assert anchor["cluster_id"] == "cl-anchor-1"
    assert anchor["run_ids"] == ["cb-subagent-a-1", "cb-subagent-a-2"]
    assert anchor["title"] == "Agent 蜂群 · 2 个并行任务"




def test_maybe_run_skips_system_completion_notice(tmp_path: Path):
    notice = (
        "[系统通知] 以下子智能体已全部结束或暂停（可能成功、失败或因限流/轮次触顶暂停）。"
        "请结合用户最初的请求，直接完成其中尚未完成的后续步骤（例如汇总、对比、成稿）。"
        " - 【codebuddy-1-美国党派】(cb-subagent-3af0c47dab-1) [已完成]: 摘要"
    )
    with patch(
        "agenticx.harness.claude_code_cb_subagents.run_codebuddy_subagents"
    ) as mocked:
        result = maybe_run_cb_subagents_for_claude_code_turn(
            parent_session_id="studio-sid",
            user_text=notice,
            cwd=str(tmp_path),
            wait_seconds=1.0,
        )
    assert result is None
    mocked.assert_not_called()


def test_cancel_codebuddy_subagent_run_stops_tracked_and_marks_store(tmp_path: Path, monkeypatch):
    owner = "studio-cancel-test"
    run_id = "cb-subagent-deadbeef-1"
    store_root = tmp_path / "sessions" / owner / "subagent_runs"
    monkeypatch.setenv("HOME", str(tmp_path))

    from agenticx.runtime.subagent_runs import SubAgentRunStore

    store = SubAgentRunStore(owner)
    store.open_run(
        run_id=run_id,
        kind="codebuddy",
        name="codebuddy-1",
        role="CodeBuddy CLI subagent",
        task="demo",
        status="running",
        provider="codebuddy",
        source_tool_call_id="near-cb-deadbeef",
        title="Agent 蜂群 · 1 个并行任务",
        detail_refs={"child_harness": "codebuddy"},
    )
    _track_cb_run(
        run_id,
        owner_session_id=owner,
        codebuddy_session_id="cb-cli-sess-cancel",
        pid=None,
    )
    stopped = {"n": 0}

    class _FakeAdapter:
        def stop(self, session_id):
            stopped["n"] += 1
            assert session_id == "cb-cli-sess-cancel"
            return True

    with patch(
        "agenticx.harness.adapters.codebuddy.CodeBuddyAdapter",
        _FakeAdapter,
    ):
        result = cancel_codebuddy_subagent_run(
            owner_session_id=owner,
            run_id=run_id,
        )
    _untrack_cb_run(run_id)
    assert result["ok"] is True
    assert result["status"] == "cancelled"
    assert stopped["n"] == 1
    record = SubAgentRunStore(owner).get_run(run_id)
    assert record is not None
    assert record.status == "cancelled"


def test_orchestration_progress_bus_start_and_complete(tmp_path: Path, monkeypatch):
    """Parent SSE bus receives mid-turn started/text/completed while CB awaits."""
    from agenticx.harness.claude_code_cb_subagents import (
        clear_cb_orchestration_progress,
        drain_cb_orchestration_progress,
    )

    report = tmp_path / "report_cb_subagent_1.md"
    report.write_text("# ok\n", encoding="utf-8")
    owner = "studio-progress-bus"

    class _FakeAdapter:
        def available(self):
            return True

        def spawn(self, cwd, options=None):
            return {"session_id": "cb-cli-sess-progress"}

        def turn(self, session_id, request):
            # Simulate a short blocking turn; mid-turn drain happens around this.
            import time as _t

            _t.sleep(0.05)
            return TurnResult(
                harness="codebuddy",
                session_id=session_id,
                status=TURN_STATUS_SUCCESS,
                result_text="进度摘要",
            )

        def stop(self, session_id):
            return True

        def drain_midturn_stream_items(self, session_id):
            # One child token during the nested wait loop.
            if getattr(self, "_drained", False):
                return []
            self._drained = True
            return [{"kind": "text", "text": "子代理草稿片段"}]

    store = MagicMock()
    store.open_run.return_value = MagicMock(
        cluster_id="cl-progress",
        badge_seq="01",
        created_at=1.0,
    )
    store.close_run.return_value = MagicMock()
    store.append_activity.return_value = MagicMock()

    clear_cb_orchestration_progress(owner)
    monkeypatch.setattr(
        "agenticx.harness.claude_code_cb_subagents.codebuddy_cli_available",
        lambda: True,
    )
    with patch(
        "agenticx.harness.adapters.codebuddy.CodeBuddyAdapter",
        _FakeAdapter,
    ), patch(
        "agenticx.runtime.subagent_runs.SubAgentRunStore",
        return_value=store,
    ):
        payload = run_codebuddy_subagents(
            "用 CodeBuddy 做 subagent 写一份报告",
            cwd=str(tmp_path),
            wait_seconds=2.0,
            parent_session_id=owner,
        )

    assert payload["ok"] is True
    items = drain_cb_orchestration_progress(owner)
    kinds = [i.get("kind") for i in items]
    assert "subagent_started" in kinds
    assert "subagent_completed" in kinds
    assert "text" in kinds
    meta_texts = [
        i.get("text", "")
        for i in items
        if i.get("kind") == "text" and i.get("agent_id") == "meta"
    ]
    assert any("正在跨引擎拉起" in t for t in meta_texts)
    assert any("已启动" in t for t in meta_texts)
    child_texts = [
        i.get("text", "")
        for i in items
        if i.get("kind") == "text" and str(i.get("agent_id") or "").startswith("cb-subagent-")
    ]
    assert any("子代理草稿片段" in t for t in child_texts)
    clear_cb_orchestration_progress(owner)


def test_publish_drain_clear_progress_helpers():
    from agenticx.harness.claude_code_cb_subagents import (
        clear_cb_orchestration_progress,
        drain_cb_orchestration_progress,
        publish_cb_orchestration_progress,
    )

    sid = "studio-progress-helpers"
    clear_cb_orchestration_progress(sid)
    publish_cb_orchestration_progress(
        sid, {"kind": "text", "agent_id": "meta", "text": "hello"}
    )
    publish_cb_orchestration_progress(
        sid, {"kind": "subagent_started", "agent_id": "cb-1", "name": "n"}
    )
    items = drain_cb_orchestration_progress(sid)
    assert len(items) == 2
    assert drain_cb_orchestration_progress(sid) == []
    clear_cb_orchestration_progress(sid)

