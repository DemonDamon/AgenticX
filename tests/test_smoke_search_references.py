"""Tests for search reference builders."""

from __future__ import annotations

from types import SimpleNamespace

from agenticx.studio.references import (
    append_turn_references,
    build_kb_references,
    build_web_references,
    queue_web_search_batch,
    reset_turn_references,
    structured_payload_for_tool_result,
    turn_reference_payload,
)


class _Hit:
    def __init__(self, title: str, url: str, snippet: str) -> None:
        self.title = title
        self.url = url
        self.snippet = snippet


def _session() -> SimpleNamespace:
    return SimpleNamespace()


def test_build_web_references_assigns_ids_and_domain() -> None:
    refs = build_web_references(
        [_Hit("Example", "https://example.com/a", "hello")],
        provider="duckduckgo",
    )
    assert len(refs) == 1
    assert refs[0]["source"] == "web"
    assert refs[0]["domain"] == "example.com"
    assert refs[0]["provider"] == "duckduckgo"


def test_web_and_kb_share_number_space() -> None:
    session = _session()
    reset_turn_references(session)
    append_turn_references(session, build_web_references([_Hit("W", "https://a.com", "s")], "duckduckgo"))
    kb = build_kb_references(
        {
            "hits": [
                {
                    "text": "chunk text",
                    "source": {"uri": "doc1", "title": "Doc", "chunk_index": 2},
                }
            ]
        }
    )
    assigned = append_turn_references(session, kb)
    assert assigned[0]["id"] == 2
    assert assigned[0]["source"] == "kb"
    assert assigned[0]["url"] == "agx://kb/doc1#2"


def test_queue_web_search_batch_and_payload() -> None:
    session = _session()
    reset_turn_references(session)
    queue_web_search_batch(session, query="test query", hits=[_Hit("T", "https://t.com", "x")], provider="duckduckgo")
    structured = structured_payload_for_tool_result(session, "web_search", {"query": "test query"}, "ok")
    assert structured is not None
    assert len(structured["references"]) == 1
    assert structured["references"][0]["id"] == 1
    payload = turn_reference_payload(session)
    assert payload["searched_queries"] == ["test query"]
