"""Near CB↔CC synthetic spawn_subagent rows for Agent 蜂群 chat UX."""

from __future__ import annotations

import json

from agenticx.harness.near_cross_harness_swarm_ui import (
    build_spawn_subagent_result,
    collect_spawn_tool_rows_from_payload,
    publish_synthetic_spawn_tool_events,
    spawn_tool_call_id,
)


def test_spawn_tool_call_id_stable():
    assert spawn_tool_call_id("cb-subagent-abc-1") == "near-spawn-cb-subagent-abc-1"


def test_build_spawn_subagent_result_ok_shape():
    body = build_spawn_subagent_result(
        run_id="cb-1",
        cluster_id="cl-9",
        name="codebuddy-1",
        role="CodeBuddy CLI subagent",
        task="write report",
        provider="codebuddy",
        model="glm",
    )
    assert body["ok"] is True
    assert body["agent_id"] == "cb-1"
    assert body["cluster_id"] == "cl-9"
    # Desktop injectLive parses this JSON from tool message content.
    parsed = json.loads(json.dumps(body))
    assert parsed["cluster_id"] == "cl-9"


def test_publish_synthetic_spawn_tool_events_emits_start_and_end():
    seen = []

    def _pub(sid, item):
        seen.append((sid, item))

    publish_synthetic_spawn_tool_events(
        _pub,
        "studio-1",
        run_id="cb-1",
        cluster_id="cl-1",
        name="codebuddy-1",
        role="CodeBuddy CLI subagent",
        task="task-a",
        provider="codebuddy",
        model="m1",
        tool_group_id="near-cb-batch",
    )
    assert len(seen) == 2
    assert seen[0][0] == "studio-1"
    assert seen[0][1]["kind"] == "tool_start"
    assert seen[0][1]["name"] == "spawn_subagent"
    assert seen[0][1]["tool_call_id"] == "near-spawn-cb-1"
    assert seen[1][1]["kind"] == "tool_end"
    assert seen[1][1]["result"]["ok"] is True
    assert seen[1][1]["result"]["cluster_id"] == "cl-1"


def test_collect_spawn_tool_rows_from_payload():
    rows = collect_spawn_tool_rows_from_payload(
        {
            "cluster_id": "cl-2",
            "batch_source_id": "near-cb-x",
            "cluster_created_at": 12.5,
            "results": [
                {
                    "run_id": "cb-a",
                    "name": "codebuddy-1",
                    "role": "CodeBuddy CLI subagent",
                    "provider": "codebuddy",
                    "ok": True,
                },
                {
                    "run_id": "cb-b",
                    "name": "codebuddy-2",
                    "provider": "codebuddy",
                    "ok": False,
                },
            ],
        }
    )
    assert len(rows) == 2
    assert rows[0]["role"] == "tool"
    assert rows[0]["tool_name"] == "spawn_subagent"
    assert rows[0]["tool_call_id"] == "near-spawn-cb-a"
    assert rows[0]["tool_group_id"] == "near-cb-x"
    body = json.loads(rows[0]["content"])
    assert body["cluster_id"] == "cl-2"
    assert body["agent_id"] == "cb-a"
