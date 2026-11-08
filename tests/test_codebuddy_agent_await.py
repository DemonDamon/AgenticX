"""CodeBuddy Agent fire-and-forget honesty (session d37c29ea)."""

from __future__ import annotations

import json
from pathlib import Path

from agenticx.wb_bridge.codebuddy_agent_await import (
    AgentSpawn,
    await_agent_artifacts,
    codebuddy_cc_subagent_guard_prefix,
    honesty_footer,
    parse_agent_spawns_from_objects,
    user_asked_for_claude_code_subagents,
)
from agenticx.wb_bridge.events import extract_tool_activity
from agenticx.harness.stream_json_text import iter_raw_tool_progress


def test_detect_claude_code_subagent_ask():
    assert user_asked_for_claude_code_subagents(
        "你能用 claude code 来作为 subagents，写两份报告"
    )
    assert user_asked_for_claude_code_subagents("用 CC 做 subagent 写推演")
    assert not user_asked_for_claude_code_subagents("写两份中美关系报告")
    assert codebuddy_cc_subagent_guard_prefix("用 Claude Code 做子代理")
    assert codebuddy_cc_subagent_guard_prefix("普通问题") == ""


def test_parse_agent_spawns_extracts_report_paths():
    call = {
        "type": "function_call",
        "name": "Agent",
        "callId": "call_a",
        "arguments": json.dumps(
            {
                "description": "报告一",
                "prompt": "保存为 /tmp/task/report_us_politics.md 并返回结论",
            },
            ensure_ascii=False,
        ),
    }
    result = {
        "type": "function_call_result",
        "name": "Agent",
        "callId": "call_a",
        "output": {
            "type": "text",
            "text": (
                "Spawned successfully.\n"
                "agent_id: general-purpose-1@team\n"
                "name: general-purpose-1\n"
                "team_name: team\n"
                "task_id: agent-aaa\n"
            ),
        },
    }
    spawns = parse_agent_spawns_from_objects([call, result])
    assert len(spawns) == 1
    assert spawns[0].name == "general-purpose-1"
    assert spawns[0].task_id == "agent-aaa"
    assert spawns[0].expected_paths == ("/tmp/task/report_us_politics.md",)


def test_await_skips_when_no_expected_paths(tmp_path: Path):
    spawns = [
        AgentSpawn(
            name="x",
            agent_id="x",
            team_name="t",
            task_id="1",
            expected_paths=(),
        )
    ]
    info = await_agent_artifacts(spawns, cwd=str(tmp_path), timeout_sec=30.0)
    assert info["ready"] is False
    assert info.get("no_expected_paths") is True
    assert info["waited_sec"] == 0.0


def test_await_ready_when_files_exist(tmp_path: Path):
    target = tmp_path / "report_us_politics.md"
    target.write_text("ok", encoding="utf-8")
    spawns = [
        AgentSpawn(
            name="x",
            agent_id="x",
            team_name="t",
            task_id="1",
            expected_paths=(str(target),),
        )
    ]
    info = await_agent_artifacts(spawns, cwd=str(tmp_path), timeout_sec=1.0)
    assert info["ready"] is True


def test_honesty_footer_when_cc_asked_and_artifacts_missing():
    spawns = [
        AgentSpawn(
            name="general-purpose-1",
            agent_id="id",
            team_name="team",
            task_id="t1",
            expected_paths=("/tmp/report_us_politics.md",),
        )
    ]
    footer = honesty_footer(
        asked_for_claude_code=True,
        spawns=spawns,
        await_info={
            "ready": False,
            "expected_paths": ["/tmp/report_us_politics.md"],
            "existing_paths": [],
            "waited_sec": 45.0,
        },
    )
    assert "Claude Code" in footer
    assert "CodeBuddy" in footer
    assert "Spawned successfully" in footer
    assert "report_us_politics.md" in footer


def test_honesty_footer_silent_without_spawns():
    assert (
        honesty_footer(
            asked_for_claude_code=True,
            spawns=[],
            await_info=None,
        )
        == ""
    )


def test_extract_tool_activity_function_call():
    line = json.dumps(
        {"type": "function_call", "name": "Agent", "callId": "c1"},
        ensure_ascii=False,
    )
    assert extract_tool_activity(line) == "Agent"


def test_iter_raw_tool_progress_function_call():
    start = json.dumps(
        {"type": "function_call", "name": "WebSearch", "callId": "c2"},
        ensure_ascii=False,
    )
    end = json.dumps(
        {
            "type": "function_call_result",
            "name": "WebSearch",
            "callId": "c2",
            "status": "success",
        },
        ensure_ascii=False,
    )
    evs = list(iter_raw_tool_progress(start))
    assert len(evs) == 1 and evs[0].kind == "start" and evs[0].name == "WebSearch"
    evs2 = list(iter_raw_tool_progress(end))
    assert len(evs2) == 1 and evs2[0].kind == "end" and evs2[0].tool_call_id == "c2"
