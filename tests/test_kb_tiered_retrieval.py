"""SP32 tiered KB retrieval — L0 snippet projection + L1 full-text cache.

Plan-Id: sp32-kb-tiered-retrieval
"""

from __future__ import annotations

from typing import List

import pytest

from agenticx.brain import search as search_mod
from agenticx.brain.search import (
    L0_SNIPPET_LIMIT,
    _HitFulltextCache,
    make_query_snippet,
    read_kb_hit,
    search_docs_brains,
)
from agenticx.brain.runtime_docs import DocsBrainRuntime
from agenticx.studio.kb.contracts import KBConfig, RetrievalHit, RetrievalHitSource


# --------------------------------------------------------------------------- #
# snippet extraction                                                          #
# --------------------------------------------------------------------------- #


def test_snippet_short_text_returned_as_is():
    assert make_query_snippet("短文本", "任意查询") == "短文本"


def test_snippet_long_text_falls_back_to_head():
    text = "甲" * 1000
    out = make_query_snippet(text, "完全无关的查询词组")
    assert out == text[:L0_SNIPPET_LIMIT]


def test_snippet_window_is_anchored_on_query_keyword():
    head = "头" * 500
    tail = "尾" * 500
    text = f"{head} 保价货物的赔付标准与流程 {tail}"
    out = make_query_snippet(text, "保价货物 赔付", limit=60)
    assert "保价货物" in out
    assert len(out) <= 60
    assert "头" * 60 not in out  # window moved away from the head


def test_snippet_cjk_2gram_anchor():
    text = ("背景铺垫。" * 200) + "未保价货物按运费三倍赔付。" + ("补充说明。" * 200)
    out = make_query_snippet(text, "未保价货物怎么赔", limit=50)
    assert "未保价" in out


def test_snippet_collapses_whitespace():
    text = "a   b\n\nc\td " * 100
    out = make_query_snippet(text, "无关词", limit=30)
    assert "\n" not in out
    assert "  " not in out


# --------------------------------------------------------------------------- #
# L1 full-text cache                                                          #
# --------------------------------------------------------------------------- #


def _hit(hit_id: str, text: str) -> dict:
    return {
        "id": hit_id,
        "score": 0.5,
        "text": text,
        "source": {"kind": "local", "uri": "/tmp/x.md", "title": "x.md", "chunk_index": 1},
        "metadata": {"document_id": "doc_1"},
    }


def test_cache_put_get_roundtrip_and_suffix_match():
    cache = _HitFulltextCache()
    cache.put("brain_a", _hit("h1", "全文A"))
    assert (cache.get("h1") or {}).get("text") == "全文A"
    assert (cache.get("h1", brain_id="brain_a") or {}).get("text") == "全文A"
    assert cache.get("h1", brain_id="brain_b") is None  # exact key wins, no cross-brain leak
    assert cache.get("missing") is None


def test_cache_lru_eviction_order():
    cache = _HitFulltextCache(max_entries=3)
    for i in range(5):
        cache.put("b", _hit(f"h{i}", f"t{i}"))
    assert cache.get("h0") is None  # evicted (oldest)
    assert cache.get("h1") is None
    assert (cache.get("h4") or {}).get("text") == "t4"


def test_read_kb_hit_miss_is_typed_error():
    out = read_kb_hit("nope::1")
    assert out["ok"] is False
    assert "knowledge_search" in out["error"]


def test_read_kb_hit_hits_cache_populated_by_search(monkeypatch):
    _install_fake_brain(monkeypatch, ["这是很长的全文内容" * 50])
    search_docs_brains(query="查询", top_k=5, detail="compact")
    out = read_kb_hit("doc_x::000000")
    assert out["ok"] is True
    assert out["text"].startswith("这是很长的全文内容")


# --------------------------------------------------------------------------- #
# search_docs_brains L0/L1 branches (fake docs brain, no chroma)              #
# --------------------------------------------------------------------------- #


class _FakeDocsRuntime(DocsBrainRuntime):
    """Bypasses __init__ (no KBRuntime/chroma); only read_config/search are used."""

    def __init__(self, hits: List[RetrievalHit]) -> None:  # noqa: D107 - no super call
        self._hits = hits

    def read_config(self) -> KBConfig:
        return KBConfig(enabled=True)

    def search(self, query: str, *, top_k: int = 5, retrieval_mode=None) -> List[RetrievalHit]:
        return self._hits[:top_k]


class _FakeBrain:
    def __init__(self, name: str = "默认文档库") -> None:
        self.name = name
        self.enabled = True


class _FakeBrainManager:
    def __init__(self, brain, runtime) -> None:
        self._brain = brain
        self._runtime = runtime

    @classmethod
    def instance(cls):
        assert cls._the_instance is not None, "fake BrainManager not installed"
        return cls._the_instance

    _the_instance = None

    def get_brain(self, brain_id: str):
        return self._brain

    def get_runtime(self, brain_id: str):
        return self._runtime


def _install_fake_brain(monkeypatch, hit_texts, *, brain_id: str = "default_docs"):
    hits = [
        RetrievalHit(
            id=f"doc_x::{i:06d}",
            score=0.9 - i * 0.1,
            text=text,
            source=RetrievalHitSource(
                kind="local", uri=f"/tmp/doc{i}.md", title=f"doc{i}.md", chunk_index=i
            ),
            metadata={"document_id": "doc_x", "chunk_index": i},
        )
        for i, text in enumerate(hit_texts)
    ]
    fake_mgr = _FakeBrainManager(_FakeBrain(), _FakeDocsRuntime(hits))
    _FakeBrainManager._the_instance = fake_mgr
    monkeypatch.setattr(search_mod, "BrainManager", _FakeBrainManager)
    monkeypatch.setattr(
        search_mod,
        "resolve_mounted_brain_ids",
        lambda **kwargs: [brain_id],
    )
    monkeypatch.setattr(search_mod, "load_avatar_brains_enabled", lambda avatar_id: None)
    search_mod._HIT_FULLTEXT_CACHE.clear()
    return hits


def test_compact_search_returns_snippets_and_caches_fulltext(monkeypatch):
    long_texts = [f"文档{i}开头。" + "内容" * 400 + f" 关键词{i}。" + "结尾" * 200 for i in range(3)]
    _install_fake_brain(monkeypatch, long_texts)

    out = search_docs_brains(query="关键词1", top_k=3, detail="compact")

    assert out["ok"] is True
    assert out["detail"] == "compact"
    assert "by_brain" not in out
    assert len(out["hits"]) == 3
    for hit in out["hits"]:
        assert len(hit["text"]) <= L0_SNIPPET_LIMIT
        assert hit["read_full_text"].startswith("knowledge_read(hit_id=")
    assert "关键词1" in out["hits"][1]["text"]  # snippet anchored on the query
    # every full text is retrievable via L1
    for i, hit in enumerate(out["hits"]):
        full = read_kb_hit(hit["id"])
        assert full["ok"] is True
        assert len(full["text"]) > L0_SNIPPET_LIMIT
        assert f"关键词{i}" in full["text"]


def test_full_search_keeps_legacy_shape(monkeypatch):
    long_texts = ["全文内容" * 100]
    hits = _install_fake_brain(monkeypatch, long_texts)

    out = search_docs_brains(query="全文", top_k=5, detail="full")

    assert "by_brain" in out
    assert out["hits"][0]["text"] == hits[0].text
    assert "read_full_text" not in out["hits"][0]
    assert "detail" not in out


def test_compact_payload_is_far_smaller_than_full(monkeypatch):
    long_texts = [f"文档{i} " + "正文" * 2000 for i in range(5)]
    _install_fake_brain(monkeypatch, long_texts)

    compact = search_docs_brains(query="文档", top_k=5, detail="compact")
    full = search_docs_brains(query="文档", top_k=5, detail="full")

    compact_size = len(str(compact))
    full_size = len(str(full))
    assert compact_size < full_size / 10  # >90% context-token reduction on long docs
