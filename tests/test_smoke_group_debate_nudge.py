"""SP4: debate heat nudge + converge hop clamp smoke tests."""

from __future__ import annotations

import time

from agenticx.runtime.graph.intervene import (
    CONVERGE_SCRATCH_KEY,
    effective_mention_hops,
)
from agenticx.runtime.graph.social import (
    DEBATE_EDGES_KEY,
    DEBATE_EDGE_THRESHOLD,
    DEBATE_NUDGE_KEY,
    note_debate_edge,
    maybe_debate_nudge,
)


def test_debate_nudge_fires_once() -> None:
    pad: dict = {}
    now = time.time()
    for i in range(DEBATE_EDGE_THRESHOLD):
        note_debate_edge(
            pad,
            source=f"agent:a{i % 2}",
            target=f"agent:a{(i + 1) % 2}",
            now=now - 1,
        )
    text1 = maybe_debate_nudge(pad, now=now)
    assert text1 and "运行图" in text1
    assert pad.get(DEBATE_NUDGE_KEY) is True
    text2 = maybe_debate_nudge(pad, now=now)
    assert text2 is None


def test_debate_nudge_skipped_under_converge() -> None:
    pad: dict = {
        CONVERGE_SCRATCH_KEY: {"max_mention_hops": 0, "until_ts": time.time() + 3600},
        DEBATE_EDGES_KEY: [],
    }
    now = time.time()
    for i in range(DEBATE_EDGE_THRESHOLD):
        note_debate_edge(pad, source="agent:a", target="agent:b", now=now)
    assert maybe_debate_nudge(pad, now=now) is None


def test_converge_flag_clamps_mention_hops() -> None:
    pad = {CONVERGE_SCRATCH_KEY: {"max_mention_hops": 0, "until_ts": time.time() + 60}}
    assert effective_mention_hops(pad, 2) == 0
    pad2: dict = {}
    assert effective_mention_hops(pad2, 2) == 2
