"""Tests for the `knowledge_search` studio tool.

Plan-Id: machi-kb-stage1-local-mvp
Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import List

import pytest

pytest.importorskip("chromadb")

from agenticx.cli.agent_tools import STUDIO_TOOLS, _tool_knowledge_search  # noqa: E402
from agenticx.studio.kb import (  # noqa: E402
    ChunkingSpec,
    EmbeddingSpec,
    FileFilterSpec,
    KBConfig,
    KBManager,
    RetrievalSpec,
    VectorStoreSpec,
)


class _DeterministicEmbedding:
    def __init__(self, dim: int = 8) -> None:
        self.dim = dim

    def embed(self, texts: List[str]) -> List[List[float]]:
        out = []
        for text in texts:
            buckets = [0.0] * self.dim
            for token in (text or "").lower().split():
                digest = hashlib.md5(token.encode("utf-8")).digest()
                for i in range(self.dim):
                    buckets[i] += digest[i] / 255.0
            norm = sum(v * v for v in buckets) ** 0.5 or 1.0
            out.append([v / norm for v in buckets])
        return out

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return self.embed(texts)


@pytest.fixture
def seeded_manager(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> KBManager:
    KBManager.reset_for_tests()
    cfg_path = tmp_path / "config.yaml"
    mgr = KBManager(config_path=str(cfg_path))
    cfg = KBConfig(
        enabled=True,
        vector_store=VectorStoreSpec(backend="chroma", path=str(tmp_path / "chroma"), collection="test_kb"),
        embedding=EmbeddingSpec(provider="ollama", model="bge-m3", dim=8),
        chunking=ChunkingSpec(strategy="recursive", chunk_size=200, chunk_overlap=20),
        file_filters=FileFilterSpec(extensions=[".md"], max_file_size_mb=5),
        retrieval=RetrievalSpec(top_k=3),
    )
    mgr.write_config(cfg)
    # Re-route runtime storage to tmp_path and install the stub embedding.
    from agenticx.studio.kb.runtime import _DocumentRegistry

    kb_dir = tmp_path / "kb"
    kb_dir.mkdir(parents=True, exist_ok=True)
    mgr._runtime._registry = _DocumentRegistry(kb_dir / "documents.json")  # type: ignore[attr-defined]
    mgr._runtime._state_path = kb_dir / "state.json"  # type: ignore[attr-defined]
    mgr._runtime._embedding_provider = _DeterministicEmbedding()  # type: ignore[attr-defined]

    # Seed a document.
    doc_path = tmp_path / "seed.md"
    doc_path.write_text("agenticx knowledge base supports chroma local indexing")
    doc = mgr.runtime.register_document(str(doc_path))
    mgr.runtime.ingest_document(doc.id)

    KBManager._instance = mgr  # type: ignore[attr-defined]
    yield mgr
    KBManager.reset_for_tests()


def test_tool_is_registered_in_studio_tools():
    names = [t["function"]["name"] for t in STUDIO_TOOLS]
    assert "knowledge_search" in names


def test_tool_rejects_empty_query(seeded_manager: KBManager):
    result = _tool_knowledge_search({"query": " "})
    payload = json.loads(result)
    assert payload["ok"] is False
    assert payload["hits"] == []


def test_tool_returns_hits(seeded_manager: KBManager):
    result = _tool_knowledge_search({"query": "agenticx chroma", "top_k": 2})
    payload = json.loads(result)
    assert payload["ok"] is True
    assert payload["source"] == "local"
    assert isinstance(payload["hits"], list)
    assert payload["used_top_k"] == len(payload["hits"])
    if payload["hits"]:
        hit = payload["hits"][0]
        assert set(["id", "score", "text", "source"]).issubset(hit.keys())
        assert hit["source"]["kind"] == "local"


def test_tool_clamps_top_k(seeded_manager: KBManager):
    payload = json.loads(_tool_knowledge_search({"query": "agenticx", "top_k": 999}))
    assert payload["ok"] is True
    assert payload["used_top_k"] <= 20


def test_tool_uses_config_default_top_k_when_omitted(
    seeded_manager: KBManager,
    monkeypatch: pytest.MonkeyPatch,
):
    captured: dict[str, int] = {}

    def _fake_search(_query: str, top_k: int = 0):
        captured["top_k"] = int(top_k)
        return []

    monkeypatch.setattr(seeded_manager.runtime, "search", _fake_search)
    payload = json.loads(_tool_knowledge_search({"query": "agenticx"}))
    assert payload["ok"] is True
    assert captured["top_k"] == seeded_manager.read_config().retrieval.top_k


def test_tool_when_kb_disabled(tmp_path: Path):
    KBManager.reset_for_tests()
    cfg_path = tmp_path / "config.yaml"
    mgr = KBManager(config_path=str(cfg_path))
    cfg = KBConfig.from_dict(None)  # enabled = False
    mgr.write_config(cfg)
    KBManager._instance = mgr  # type: ignore[attr-defined]
    payload = json.loads(_tool_knowledge_search({"query": "anything"}))
    assert payload["ok"] is True
    assert payload["disabled"] is True
    assert payload["hits"] == []
    KBManager.reset_for_tests()
