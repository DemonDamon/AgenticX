"""SP4: H2A / A2A MESSAGE edge projection smoke tests."""

from __future__ import annotations

from pathlib import Path

from agenticx.runtime.graph.social import (
    HUMAN_NODE_ID,
    ensure_presence_run,
    message_edge_events,
    project_h2a_fanout,
    upsert_message_edge,
)
from agenticx.runtime.graph.store import GraphRunStore


def test_ensure_presence_run_ephemeral_and_members(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = ensure_presence_run(
        session_id="s1",
        group_id="g1",
        member_ids=["a1", "a2"],
        store=store,
    )
    assert run.meta.get("ephemeral") is True
    assert HUMAN_NODE_ID in run.nodes
    assert "agent:a1" in run.nodes
    assert "agent:a2" in run.nodes
    again = ensure_presence_run(
        session_id="s1",
        group_id="g1",
        member_ids=["a1", "a2", "a3"],
        store=store,
        existing_run_id=run.run_id,
    )
    assert again.run_id == run.run_id
    assert "agent:a3" in again.nodes


def test_ensure_presence_run_uses_member_display_names(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = ensure_presence_run(
        session_id="s1",
        group_id="g1",
        member_ids=["12e6fedc069f", "__meta__"],
        store=store,
        member_labels={
            "12e6fedc069f": "架构师·阿析",
            "__meta__": "Machi",
        },
    )
    assert run.nodes["agent:12e6fedc069f"].label == "架构师·阿析"
    assert run.nodes["agent:__meta__"].label == "Machi"
    # Refresh previously hex-labeled node when names arrive later.
    run.nodes["agent:12e6fedc069f"].label = "12e6fedc069f"
    store.save(run, bump_version=True)
    again = ensure_presence_run(
        session_id="s1",
        group_id="g1",
        member_ids=["12e6fedc069f", "__meta__"],
        store=store,
        existing_run_id=run.run_id,
        member_labels={"12e6fedc069f": "架构师·阿析", "__meta__": "Machi"},
    )
    assert again.nodes["agent:12e6fedc069f"].label == "架构师·阿析"


def test_upsert_message_edge_reuses_id(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = ensure_presence_run(
        session_id="s1",
        group_id="g1",
        member_ids=["a1", "a2"],
        store=store,
    )
    e1 = upsert_message_edge(run, source="agent:a1", target="agent:a2", label="mention")
    e2 = upsert_message_edge(run, source="agent:a1", target="agent:a2", label="mention")
    assert e1.id == e2.id == "msg_agent:a1_agent:a2"
    assert sum(1 for e in run.edges if e.id == e1.id) == 1
    events = message_edge_events(run, e1, summary="hello")
    types = [ev["type"] for ev in events]
    assert "graph.edge_updated" in types
    assert "graph.edge_flow" in types
    assert events[0]["edge"]["kind"] == "message"


def test_h2a_fanout_multi_targets(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = ensure_presence_run(
        session_id="s1",
        group_id="g1",
        member_ids=["a1", "a2"],
        store=store,
    )
    edges, events = project_h2a_fanout(run, ["a1", "a2"])
    assert len(edges) >= 2
    assert all(e.source == HUMAN_NODE_ID for e in edges)
    assert all(e.kind.value == "message" for e in edges)
    assert len(events) >= 4  # updated+flow per edge


def test_h2a_fanout_replaces_stale_human_edges(tmp_path: Path) -> None:
    store = GraphRunStore(root=tmp_path)
    run = ensure_presence_run(
        session_id="s1",
        group_id="g1",
        member_ids=["a1", "a2", "__meta__"],
        store=store,
    )
    project_h2a_fanout(run, ["a1"])
    assert any(e.target == "agent:a1" for e in run.edges if e.source == HUMAN_NODE_ID)
    edges, events = project_h2a_fanout(run, ["__meta__"])
    human_targets = [e.target for e in run.edges if e.source == HUMAN_NODE_ID and e.kind.value == "message"]
    assert human_targets == ["agent:__meta__"]
    assert all(e.target == "agent:__meta__" for e in edges)
    assert any(ev.get("type") == "graph.edge_removed" for ev in events)
