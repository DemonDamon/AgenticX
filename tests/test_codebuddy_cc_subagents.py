"""Near-orchestrated Claude Code CLI subagents from CodeBuddy asks."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from agenticx.harness.codebuddy_cc_subagents import (
    format_cc_subagent_result_text,
    maybe_run_cc_subagents_for_codebuddy_turn,
    plan_claude_code_subagent_tasks,
    run_claude_code_subagents,
)
from agenticx.harness.types import TURN_STATUS_SUCCESS, TurnResult


def test_plan_splits_two_report_topics(tmp_path: Path):
    text = "你能用 claude code 来作为 subagents，写两份关于后续的美国党派和中国关系的推演预测报告"
    tasks = plan_claude_code_subagent_tasks(text, cwd=str(tmp_path))
    assert len(tasks) == 2
    joined = " ".join(t.prompt for t in tasks)
    assert "美国党派" in joined or "党派" in tasks[0].name or "党派" in tasks[0].prompt
    assert "中国关系" in joined or "中国" in tasks[1].prompt
    assert all(t.output_path.endswith(".md") for t in tasks)


def test_plan_default_two_when_subagents_plural(tmp_path: Path):
    text = "用 CC 做两个 subagent 一起调研这个仓库的 README"
    tasks = plan_claude_code_subagent_tasks(text, cwd=str(tmp_path))
    assert len(tasks) == 2


def test_format_unavailable():
    text = format_cc_subagent_result_text({"error": "claude_code_unavailable", "results": []})
    assert "claude" in text.lower()
    assert "无法跨引擎" in text


def test_maybe_run_returns_none_without_cc_ask(tmp_path: Path):
    assert (
        maybe_run_cc_subagents_for_codebuddy_turn(
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
                "name": "claude-code-1",
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
        "agenticx.harness.codebuddy_cc_subagents.run_claude_code_subagents",
        return_value=fake_payload,
    ) as mocked:
        result = maybe_run_cc_subagents_for_codebuddy_turn(
            parent_session_id="s1",
            user_text="用 Claude Code 做 subagent 写报告",
            cwd=str(tmp_path),
            wait_seconds=5.0,
        )
    assert result is not None
    assert result.status == TURN_STATUS_SUCCESS
    assert result.harness == "codebuddy"
    assert "Claude Code CLI" in result.result_text
    assert result.detail.get("child_harness") == "claude-code"
    mocked.assert_called_once()
    assert mocked.call_args.kwargs.get("parent_session_id") == "s1"


def test_run_registers_subagent_run_store(tmp_path: Path, monkeypatch):
    """Each CC child open_run/close_run under the parent CodeBuddy session_id."""
    report = tmp_path / "report_cc_subagent_1.md"
    report.write_text("# ok\n", encoding="utf-8")

    class _FakeAdapter:
        def available(self):
            return True

        def spawn(self, cwd, options=None):
            return {"session_id": "cc-cli-sess-1"}

        def turn(self, session_id, request):
            return TurnResult(
                harness="claude-code",
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
        "agenticx.harness.codebuddy_cc_subagents.claude_code_cli_available",
        lambda: True,
    )
    with patch(
        "agenticx.harness.adapters.claude_code.ClaudeCodeAdapter",
        _FakeAdapter,
    ), patch(
        "agenticx.runtime.subagent_runs.SubAgentRunStore",
        return_value=store,
    ) as store_cls:
        payload = run_claude_code_subagents(
            "用 Claude Code 做 subagent 写一份报告",
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
    assert open_kwargs["kind"] == "claude-code"
    assert open_kwargs["provider"] == "claude-code"
    assert open_kwargs["status"] == "running"
    assert "Claude Code CLI" in open_kwargs["role"]
    assert open_kwargs["name"].startswith("claude-code")
    assert store_cls.call_args_list[0].args[0] == "owner-cb-session"

    close_calls = store.close_run.call_args_list
    assert close_calls, "expected close_run"
    close_args, close_kwargs = close_calls[0].args, close_calls[0].kwargs
    assert close_args[0].startswith("cc-subagent-")
    assert close_kwargs["status"] == "completed"
    assert close_kwargs["result_file"].endswith("report_cc_subagent_1.md")
    assert any(
        str(p).endswith("report_cc_subagent_1.md")
        for p in (close_kwargs.get("output_files") or [])
    )

    # every SubAgentRunStore constructed with parent session id
    for call in store_cls.call_args_list:
        assert call.args[0] == "owner-cb-session"
