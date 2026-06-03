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


def test_build_kb_references_prefers_document_id_over_source_path_uri() -> None:
    kb = build_kb_references(
        {
            "hits": [
                {
                    "id": "doc_6097da28cf1579b4::000000",
                    "text": "chunk",
                    "source": {
                        "uri": "/Users/damon/.agenticx/storage/vector_db/uploads/foo.pdf",
                        "title": "foo.pdf",
                        "chunk_index": 0,
                    },
                    "metadata": {
                        "document_id": "doc_6097da28cf1579b4",
                        "source_path": "/Users/damon/.agenticx/storage/vector_db/uploads/foo.pdf",
                    },
                }
            ]
        }
    )
    assert len(kb) == 1
    assert kb[0]["url"] == "agx://kb/doc_6097da28cf1579b4#0"
    assert kb[0]["kb_source_path"].endswith("foo.pdf")


def test_build_kb_references_snippet_is_chunk_text_only() -> None:
    kb = build_kb_references(
        {
            "hits": [
                {
                    "text": "chunk only",
                    "score": 0.912,
                    "source": {"uri": "doc1", "title": "Doc"},
                }
            ]
        }
    )
    assert len(kb) == 1
    assert kb[0]["snippet"] == "chunk only"
    assert "score=" not in kb[0]["snippet"]


def test_kb_structured_payload_from_full_result_then_truncated_yields_none() -> None:
    """Regression: references must be parsed from the un-compacted raw result.

    micro_compact_tool_result truncates the JSON middle ("... truncated ..."),
    so json.loads on the compacted string fails and references vanish. The
    runtime must pass the full raw_result here, not the compacted one.
    """
    full = (
        '{"ok": true, "hits": [{"id": "doc1::0", "score": 0.5, '
        '"text": "AI gateway chunk", "source": {"uri": "doc1", "title": "Doc", "chunk_index": 0}}]}'
    )
    session = _session()
    reset_turn_references(session)
    structured = structured_payload_for_tool_result(
        session, "knowledge_search", {"query": "AI 网关"}, full
    )
    assert structured is not None
    assert len(structured["references"]) == 1
    assert structured["references"][0]["source"] == "kb"

    # The micro-compacted form (truncated middle) is unparseable -> no references.
    compacted = (
        "[micro-compact tool=knowledge_search original_chars=14949]\n"
        '{"ok": true, "hits": [{"id": "doc1::0", "score": 0.5, "text": "AI gat\n'
        "... truncated (9000 chars omitted) ...\n"
        '"chunk_index": 0}}]}'
    )
    session2 = _session()
    reset_turn_references(session2)
    assert (
        structured_payload_for_tool_result(
            session2, "knowledge_search", {"query": "AI 网关"}, compacted
        )
        is None
    )


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
