"""Near-orchestrated Claude Code CLI subagents from CodeBuddy asks."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

from agenticx.harness.codebuddy_cc_subagents import (
    format_cc_subagent_result_text,
    maybe_run_cc_subagents_for_codebuddy_turn,
    plan_claude_code_subagent_tasks,
)
from agenticx.harness.types import TURN_STATUS_SUCCESS


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
