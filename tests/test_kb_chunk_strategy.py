"""Tests for optional heading chunking and parent-child indexing.

Author: Damon Li
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
    KBRuntime,
    RetrievalSpec,
    VectorStoreSpec,
)
from agenticx.studio.kb.chunk_strategy import split_document  # noqa: E402


class _DeterministicEmbedding:
    def __init__(self, dim: int = 8) -> None:
        self.dim = dim

    def embed(self, texts: List[str]) -> List[List[float]]:
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


def test_auto_heading_sets_context_header():
    text = (
        "# One\n\nalpha section body here.\n"
        "# Two\n\nbeta section body here.\n"
        "# Three\n\ngamma section body here.\n"
    )
    rows = split_document(
        text,
        ChunkingSpec(strategy="auto", chunk_size=500, chunk_overlap=20),
        document_id="doc",
    )
    assert rows
    assert any(str(row.get("context_header") or "").strip() for row in rows)
    assert all(not str(row.get("text") or "").startswith("# ") for row in rows)


def test_heading_tier_discarded_when_it_does_not_split():
    text = "# A\n\nshort\n# B\n\nshort\n# C\n\n" + ("word " * 2000)
    rows = split_document(
        text,
        ChunkingSpec(strategy="auto", chunk_size=200, chunk_overlap=20),
        document_id="doc",
    )
    assert len(rows) > 1
    assert max(len(str(row.get("text") or "")) for row in rows) <= 400


def test_parent_child_indexes_children_and_expands_parent(tmp_path: Path):
    runtime = KBRuntime(
        config=KBConfig(
            enabled=True,
            vector_store=VectorStoreSpec(
                backend="chroma",
                path=str(tmp_path / "chroma"),
                collection="parent_child",
            ),
            embedding=EmbeddingSpec(provider="ollama", model="bge-m3", dim=8),
            chunking=ChunkingSpec(
                strategy="auto",
                chunk_size=200,
                chunk_overlap=20,
                parent_child=True,
                parent_chunk_size=400,
                child_chunk_size=120,
            ),
            file_filters=FileFilterSpec(extensions=[".md"], max_file_size_mb=10),
            retrieval=RetrievalSpec(top_k=5, retrieval_mode="vector"),
        ),
        registry_dir=tmp_path / "kb",
    )
    runtime._embedding_provider = _DeterministicEmbedding()  # type: ignore[attr-defined]
    captured: dict = {"roles": []}
    store = runtime._store()
    original = store.upsert

    def _spy(**kwargs):
        captured["roles"].extend(meta.get("chunk_role") for meta in kwargs["metadatas"])
        captured["ids"] = list(kwargs["ids"])
        return original(**kwargs)

    store.upsert = _spy  # type: ignore[method-assign]
    path = tmp_path / "doc.md"
    path.write_text(
        "# Alpha\n\nPARENT_ALPHA_BODY is the section.\n"
        "# Beta\n\nPARENT_BETA_BODY is the section.\n"
        "# Gamma\n\nPARENT_GAMMA_BODY is the section.\n",
        encoding="utf-8",
    )
    doc = runtime.register_document(str(path))
    report = runtime.ingest_document(doc.id)
    assert report.failed == 0, report.reasons
    assert captured["roles"]
    assert "parent" not in captured["roles"]
    assert all(role == "child" for role in captured["roles"])
    hits = runtime.search("PARENT_ALPHA_BODY", top_k=3, retrieval_mode="vector")
    assert hits
    assert "PARENT_ALPHA_BODY" in hits[0].text
