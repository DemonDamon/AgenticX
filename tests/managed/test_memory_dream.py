#!/usr/bin/env python3
"""Memory dream consolidation: transcripts, batches, parsing, and the quality gate.

Author: Damon Li
"""

from __future__ import annotations

import json
from types import SimpleNamespace

import pytest

from agenticx.managed.memory_dream import (
    BATCH_CHARS,
    DreamError,
    DreamMemory,
    SessionTranscript,
    batch_transcripts,
    check_input_memories,
    consolidate,
    gate_memories,
    parse_dream_response,
    transcript_from_events,
)


def test_transcript_primary_thread_only() -> None:
    old = [
        {"type": "user.message", "content": [{"type": "text", "text": "x" * 4000}]}
        for _ in range(6)
    ]
    events = [
        *old,
        {"type": "user.message", "content": [{"type": "text", "text": "hello"}]},
        {
            "type": "agent.message",
            "thread_id": "thread-1",
            "content": [{"type": "text", "text": "side channel"}],
        },
        {"type": "agent.tool_result", "content": [{"type": "text", "text": "tool noise"}]},
        {"type": "agent.message", "thread_id": "", "content": [{"type": "text", "text": "answer"}]},
    ]
    transcript = transcript_from_events("session-1", None, events)
    assert transcript is not None
    assert len(transcript.text) <= 20000
    assert "side channel" not in transcript.text
    assert "tool noise" not in transcript.text
    assert "hello" in transcript.text
    assert transcript.text.endswith("assistant: answer")


def test_batch_transcripts_respects_budget() -> None:
    # 20000 * 3 == BATCH_CHARS, so the inclusive budget packs 3 + 2, not 2/2/1.
    transcripts = [
        SessionTranscript(session_id=str(index), title=None, text="x" * 20000)
        for index in range(5)
    ]
    batches = batch_transcripts(transcripts)
    assert [len(batch) for batch in batches] == [3, 2]
    assert all(sum(len(item.text) for item in batch) <= BATCH_CHARS for batch in batches)


def test_input_too_large() -> None:
    memories = [DreamMemory(path=f"/n/{index}.md", content="a") for index in range(301)]
    with pytest.raises(DreamError) as caught:
        check_input_memories(memories)
    assert caught.value.error_type == "input_too_large"


@pytest.mark.asyncio
async def test_consolidate_uses_previous_batch_output() -> None:
    transcripts = [
        SessionTranscript("s1", "first", "a" * 40000),
        SessionTranscript("s2", None, "b" * 40000),
    ]
    seen: list[str] = []

    async def invoke(messages: list[dict[str, str]]) -> str:
        seen.append(messages[-1]["content"])
        if len(seen) == 1:
            return json.dumps({"memories": [{"path": "/a.md", "content": "from first"}], "notes": "one"})
        return json.dumps({"memories": [{"path": "/b.md", "content": "from second"}], "notes": "two"})

    outcome = await consolidate(
        memories=[DreamMemory("/seed.md", "seed")],
        transcripts=transcripts,
        instructions="keep stable facts",
        invoke=invoke,
        should_stop=lambda: False,
    )
    assert "/a.md" in seen[1]
    assert [item.path for item in outcome.memories] == ["/b.md"]
    assert outcome.notes == "two"
    assert outcome.batches == 2


def test_parse_wrapped_json() -> None:
    parsed = parse_dream_response(
        'note\n{"memories": [{"path": "/a.md", "content": "x"}, {"path": 1}], "notes": "ok"}\ndone'
    )
    assert parsed is not None
    memories, notes = parsed
    assert memories == [DreamMemory("/a.md", "x")]
    assert notes == "ok"
    assert parse_dream_response("no object here") is None


@pytest.mark.asyncio
async def test_retry_once_then_fail() -> None:
    calls = 0

    async def invoke(messages: list[dict[str, str]]) -> str:
        nonlocal calls
        calls += 1
        return "not json"

    with pytest.raises(DreamError) as caught:
        await consolidate(
            memories=[],
            transcripts=[SessionTranscript("s", None, "hello")],
            instructions="keep",
            invoke=invoke,
            should_stop=lambda: False,
        )
    assert caught.value.error_type == "model_output_invalid"
    assert calls == 2


def test_gate_memories(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_scan(text: str, *, source: str = "community") -> SimpleNamespace:
        return SimpleNamespace(text=text, source=source)

    def fake_allow(result: SimpleNamespace, source: str | None = None) -> tuple[bool, str]:
        if getattr(result, "text", "") == "BLOCKME":
            return False, "blocked"
        return True, "ok"

    monkeypatch.setattr("agenticx.managed.memory_dream.scan_skill_markdown_text", fake_scan)
    monkeypatch.setattr("agenticx.managed.memory_dream.should_allow", fake_allow)
    memories = [
        DreamMemory("notes", "missing slash"),
        DreamMemory("/empty.md", "   "),
        DreamMemory("/big.md", "x" * 102401),
        DreamMemory("/dup.md", "older"),
        DreamMemory("/dup.md", "newer"),
        DreamMemory("/secret.md", "BLOCKME"),
        *[DreamMemory(f"/n/{index}.md", "ok") for index in range(301)],
    ]
    kept, rejected = gate_memories(memories)
    reasons = {item["path"]: item["reason"] for item in rejected}
    assert reasons["notes"] == "invalid path"
    assert reasons["/empty.md"] == "empty content"
    assert reasons["/big.md"] == "content too large"
    assert reasons["/dup.md"] == "duplicate path"
    assert reasons["/secret.md"] == "blocked by safety scan"
    assert any(item["reason"] == "over limit" for item in rejected)
    assert DreamMemory("/dup.md", "newer") in kept
    assert len(kept) <= 300


@pytest.mark.asyncio
async def test_should_stop_between_batches() -> None:
    calls = 0
    checks = 0

    async def invoke(messages: list[dict[str, str]]) -> str:
        nonlocal calls
        calls += 1
        return json.dumps({"memories": [{"path": "/a.md", "content": "kept"}], "notes": "n"})

    def should_stop() -> bool:
        nonlocal checks
        checks += 1
        return checks >= 2

    with pytest.raises(DreamError) as caught:
        await consolidate(
            memories=[],
            transcripts=[
                SessionTranscript("s1", None, "a" * 40000),
                SessionTranscript("s2", None, "b" * 40000),
            ],
            instructions="keep",
            invoke=invoke,
            should_stop=should_stop,
        )
    assert caught.value.error_type == "cancelled"
    assert calls == 1
