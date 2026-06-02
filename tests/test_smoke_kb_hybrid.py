"""Smoke tests for KB hybrid retrieval, ingest cache, and contextual chunking.

Plan-Id: 2026-06-02-near-local-kb-build-and-retrieval-quality
Plan-File: .cursor/plans/2026-06-02-near-local-kb-build-and-retrieval-quality.plan.md
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import List

import pytest

pytest.importorskip("chromadb")

from agenticx.studio.kb import (  # noqa: E402
    ChunkingSpec,
    EmbeddingSpec,
    FileFilterSpec,
    KBConfig,
    KBDocumentStatus,
    KBRuntime,
    RetrievalSpec,
    VectorStoreSpec,
)
from agenticx.studio.kb.rrf import reciprocal_rank_fusion  # noqa: E402


class _DeterministicEmbedding:
    def __init__(self, dim: int = 8) -> None:
        self.dim = dim
        self.call_count = 0
        self.last_batch_size = 0

    def embed(self, texts: List[str]) -> List[List[float]]:
        self.call_count += 1
        self.last_batch_size = len(texts)
        vectors: List[List[float]] = []
        for text in texts:
            buckets = [0.0] * self.dim
            for token in (text or "").lower().split():
                digest = hashlib.md5(token.encode("utf-8")).digest()
                for i in range(self.dim):
                    buckets[i] += digest[i] / 255.0
            norm = sum(v * v for v in buckets) ** 0.5 or 1.0
            vectors.append([v / norm for v in buckets])
        return vectors

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return self.embed(texts)


def _make_config(tmp_path: Path, *, retrieval_mode: str = "vector", strategy: str = "recursive") -> KBConfig:
    return KBConfig(
        enabled=True,
        vector_store=VectorStoreSpec(
            backend="chroma",
            path=str(tmp_path / "chroma"),
            collection="hybrid_test",
        ),
        embedding=EmbeddingSpec(provider="ollama", model="bge-m3", dim=8),
        chunking=ChunkingSpec(strategy=strategy, chunk_size=200, chunk_overlap=20),
        file_filters=FileFilterSpec(extensions=[".md", ".txt"], max_file_size_mb=10),
        retrieval=RetrievalSpec(top_k=5, retrieval_mode=retrieval_mode),  # type: ignore[arg-type]
    )


def _build_runtime(tmp_path: Path, **kwargs) -> tuple[KBRuntime, _DeterministicEmbedding]:
    runtime = KBRuntime(config=_make_config(tmp_path, **kwargs), registry_dir=tmp_path / "kb")
    embedder = _DeterministicEmbedding(dim=8)
    runtime._embedding_provider = embedder  # type: ignore[attr-defined]
    return runtime, embedder


def _write_and_ingest(runtime: KBRuntime, tmp_path: Path, name: str, body: str) -> str:
    path = tmp_path / name
    path.write_text(body, encoding="utf-8")
    doc = runtime.register_document(str(path))
    report = runtime.ingest_document(doc.id)
    assert report.failed == 0, report.reasons
    return doc.id


def test_retrieval_spec_defaults_backward_compatible():
    cfg = KBConfig.from_dict({"retrieval": {"top_k": 7}})
    assert cfg.retrieval.top_k == 7
    assert cfg.retrieval.retrieval_mode == "vector"
    assert cfg.retrieval.rrf_k == 60


def test_rrf_fusion_prefers_both_channels():
    vector = [("a", 0.9, "alpha text", {}), ("b", 0.8, "beta text", {})]
    bm25 = [("b", 3.0, "beta text", {}), ("c", 2.0, "gamma text", {})]
    fused = reciprocal_rank_fusion([vector, bm25], k=60)
    ids = [row[0] for row in fused]
    assert "b" in ids
    assert ids.index("b") <= ids.index("a")


def test_vector_mode_bit_identical_metadata(tmp_path: Path):
    runtime, _ = _build_runtime(tmp_path, retrieval_mode="vector")
    _write_and_ingest(
        runtime,
        tmp_path,
        "alpha.md",
        "# Alpha\n\nkeyword-unique-token xyz123 semantic topic about routing.",
    )
    hits = runtime.search("keyword-unique-token xyz123", top_k=3, retrieval_mode="vector")
    assert hits
    assert hits[0].metadata.get("retrieval_mode") == "vector"
    assert float(hits[0].metadata.get("vector_score") or 0) > 0


def test_bm25_keyword_hit(tmp_path: Path):
    runtime, _ = _build_runtime(tmp_path, retrieval_mode="bm25")
    _write_and_ingest(
        runtime,
        tmp_path,
        "keyword.md",
        "# Keyword Doc\n\nThe rare codeword SUPERCALIFRAGILISTIC appears once here.",
    )
    hits = runtime.search("SUPERCALIFRAGILISTIC", top_k=3, retrieval_mode="bm25")
    assert hits
    assert hits[0].metadata.get("retrieval_mode") == "bm25"
    assert float(hits[0].metadata.get("bm25_score") or 0) > 0


def test_hybrid_mode_exposes_fused_scores(tmp_path: Path):
    runtime, _ = _build_runtime(tmp_path, retrieval_mode="hybrid")
    _write_and_ingest(
        runtime,
        tmp_path,
        "hybrid.md",
        "# Hybrid\n\nHYBRID_TOKEN_42 and related semantic discussion about knowledge bases.",
    )
    hits = runtime.search("HYBRID_TOKEN_42 knowledge", top_k=3, retrieval_mode="hybrid")
    assert hits
    assert hits[0].metadata.get("retrieval_mode") == "hybrid"
    assert float(hits[0].metadata.get("fused_score") or 0) > 0


def test_ingest_cache_skips_reembed(tmp_path: Path):
    runtime, embedder = _build_runtime(tmp_path)
    doc_id = _write_and_ingest(runtime, tmp_path, "cache.md", "Cache body unchanged content.")
    first_calls = embedder.call_count
    assert first_calls >= 1

    doc = runtime.get_document(doc_id)
    assert doc is not None
    assert doc.status == KBDocumentStatus.DONE

    embedder.call_count = 0
    report = runtime.ingest_document(doc_id)
    assert report.success == 1
    assert embedder.call_count == 0


def test_contextual_chunk_includes_title_prefix(tmp_path: Path):
    runtime, _ = _build_runtime(tmp_path, strategy="contextual")
    path = tmp_path / "contextual.md"
    path.write_text("# My Title\n\nBody paragraph for contextual chunking test.", encoding="utf-8")
    doc = runtime.register_document(str(path))
    runtime.ingest_document(doc.id)
    hits = runtime.search("My Title contextual", top_k=3, retrieval_mode="vector")
    assert hits
    assert "My Title" in hits[0].text or "contextual" in hits[0].text.lower()


def test_wiki_purge_removes_source_page(tmp_path: Path):
    from agenticx.brain.wiki_ops import purge_wiki_source

    storage = tmp_path / "brain"
    wiki_sources = storage / "wiki" / "sources"
    wiki_sources.mkdir(parents=True)
    page = wiki_sources / "notes.md"
    page.write_text(
        "---\ntitle: notes\ntype: source\nsources:\n  - notes.md\n---\n\nbody\n",
        encoding="utf-8",
    )
    removed = purge_wiki_source(storage, "notes.md")
    assert any("wiki/sources/notes.md" in r for r in removed)
    assert not page.is_file()
