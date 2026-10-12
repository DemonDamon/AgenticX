"""Tests for the `knowledge_search` / `knowledge_read` studio tools.

Plan-Id: machi-kb-stage1-local-mvp
Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md
SP32: tiered retrieval — L0 compact search + L1 knowledge_read.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import List

import pytest

pytest.importorskip("chromadb")

from agenticx.brain.search import L0_SNIPPET_LIMIT  # noqa: E402
from agenticx.cli.agent_tools import (  # noqa: E402
    STUDIO_TOOLS,
    _tool_knowledge_read,
    _tool_knowledge_search,
)
import agenticx.brain.registry as brain_registry_mod  # noqa: E402
from agenticx.brain.registry import BrainRegistry  # noqa: E402
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
    # Isolate the brain registry under tmp_path (same pattern as
    # tests/brain/test_registry_mount.py) so nothing touches ~/.agenticx.
    brains = tmp_path / "brains"
    avatars = tmp_path / "avatars"
    cfg_yaml = tmp_path / "config.yaml"
    cfg_yaml.write_text("knowledge_base:\n  enabled: true\n", encoding="utf-8")
    monkeypatch.setattr("agenticx.brain.registry.AGENTICX_HOME", tmp_path)
    monkeypatch.setattr("agenticx.brain.registry.BRAINS_ROOT", brains)
    monkeypatch.setattr("agenticx.brain.registry.REGISTRY_FILE", brains / "registry.json")
    monkeypatch.setattr("agenticx.brain.registry.CONFIG_YAML", cfg_yaml)
    monkeypatch.setattr("agenticx.brain.registry.AVATARS_ROOT", avatars)
    monkeypatch.setattr("agenticx.brain.registry.LEGACY_KB_REGISTRY", tmp_path / "storage" / "kb")
    monkeypatch.setattr("agenticx.avatar.registry.AVATARS_ROOT", avatars)
    BrainRegistry.reset_for_tests()
    KBManager.reset_for_tests()

    reg = BrainRegistry.instance()
    reg.bootstrap()
    brain = reg.get(brain_registry_mod.DEFAULT_DOCS_BRAIN_ID or "default_docs")
    assert brain is not None

    # Route the default docs brain's vector store to tmp_path with a stub
    # embedding provider, then seed one document.
    cfg = KBConfig(
        enabled=True,
        vector_store=VectorStoreSpec(
            backend="chroma", path=str(tmp_path / "chroma"), collection="test_kb"
        ),
        embedding=EmbeddingSpec(provider="ollama", model="bge-m3", dim=8),
        chunking=ChunkingSpec(strategy="recursive", chunk_size=200, chunk_overlap=20),
        file_filters=FileFilterSpec(extensions=[".md"], max_file_size_mb=5),
        retrieval=RetrievalSpec(top_k=3),
    )
    from agenticx.brain.manager import BrainManager

    docs_rt = BrainManager.instance().default_docs_runtime()
    docs_rt.write_config(cfg)
    runtime = docs_rt.runtime
    runtime._embedding_provider = _DeterministicEmbedding()  # type: ignore[attr-defined]

    doc_path = tmp_path / "seed.md"
    doc_path.write_text("agenticx knowledge base supports chroma local indexing")
    doc = runtime.register_document(str(doc_path))
    runtime.ingest_document(doc.id)

    mgr = KBManager.instance()
    yield mgr
    KBManager.reset_for_tests()


def test_tools_are_registered_in_studio_tools():
    names = [t["function"]["name"] for t in STUDIO_TOOLS]
    assert "knowledge_search" in names
    assert "knowledge_read" in names


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


def test_tool_compact_by_default_and_ui_contract_intact(seeded_manager: KBManager):
    """SP32 L0: default detail is compact; UI citation fields all survive."""
    result = _tool_knowledge_search({"query": "agenticx chroma", "top_k": 2})
    payload = json.loads(result)
    assert payload["detail"] == "compact"
    assert "by_brain" not in payload  # dead weight for the model, dropped in L0
    for hit in payload["hits"]:
        assert len(hit["text"]) <= L0_SNIPPET_LIMIT
        assert hit["text"].strip(), "UI snippet (text[:240]) must stay non-empty"
        assert hit["read_full_text"].startswith("knowledge_read(hit_id=")
        assert "document_id" in hit["metadata"]  # agx://kb/<doc_id> URL source
        assert hit["source"]["title"]


def test_tool_detail_full_returns_full_text(seeded_manager: KBManager):
    result = _tool_knowledge_search(
        {"query": "agenticx chroma", "top_k": 2, "detail": "full"}
    )
    payload = json.loads(result)
    assert "by_brain" in payload
    compact = json.loads(_tool_knowledge_search({"query": "agenticx chroma", "top_k": 2}))
    if compact["hits"]:
        assert compact["hits"][0]["text"] in payload["hits"][0]["text"] or len(
            payload["hits"][0]["text"]
        ) >= len(compact["hits"][0]["text"])


def test_knowledge_read_roundtrip_after_compact_search(seeded_manager: KBManager):
    compact = json.loads(_tool_knowledge_search({"query": "agenticx chroma", "top_k": 2}))
    if not compact["hits"]:
        pytest.skip("no hits returned")
    hit_id = compact["hits"][0]["id"]
    snippet = compact["hits"][0]["text"]
    full = json.loads(_tool_knowledge_read({"hit_id": hit_id}))
    assert full["ok"] is True
    assert len(full["text"]) >= len(snippet)
    assert full["id"] == hit_id


def test_knowledge_read_miss_returns_typed_error(seeded_manager: KBManager):
    payload = json.loads(_tool_knowledge_read({"hit_id": "doc_nonexistent::000042"}))
    assert payload["ok"] is False
    assert "knowledge_search" in payload["error"]
    assert json.loads(_tool_knowledge_read({"hit_id": " "}))["ok"] is False


def test_tool_clamps_top_k(seeded_manager: KBManager):
    payload = json.loads(_tool_knowledge_search({"query": "agenticx", "top_k": 999}))
    assert payload["ok"] is True
    assert payload["used_top_k"] <= 20


def test_tool_uses_config_default_top_k_when_omitted(
    seeded_manager: KBManager,
    monkeypatch: pytest.MonkeyPatch,
):
    captured: dict[str, int] = {}

    def _fake_search(_query: str, top_k: int = 0, retrieval_mode=None):
        captured["top_k"] = int(top_k)
        return []

    from agenticx.brain.manager import BrainManager

    docs_rt = BrainManager.instance().default_docs_runtime()
    monkeypatch.setattr(docs_rt.runtime, "search", _fake_search)
    payload = json.loads(_tool_knowledge_search({"query": "agenticx"}))
    assert payload["ok"] is True
    assert captured["top_k"] == seeded_manager.read_config().retrieval.top_k


def test_tool_when_kb_disabled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    brains = tmp_path / "brains"
    cfg_yaml = tmp_path / "config.yaml"
    cfg_yaml.write_text("knowledge_base:\n  enabled: false\n", encoding="utf-8")
    monkeypatch.setattr("agenticx.brain.registry.AGENTICX_HOME", tmp_path)
    monkeypatch.setattr("agenticx.brain.registry.BRAINS_ROOT", brains)
    monkeypatch.setattr("agenticx.brain.registry.REGISTRY_FILE", brains / "registry.json")
    monkeypatch.setattr("agenticx.brain.registry.CONFIG_YAML", cfg_yaml)
    monkeypatch.setattr("agenticx.brain.registry.AVATARS_ROOT", tmp_path / "avatars")
    monkeypatch.setattr(
        "agenticx.brain.registry.LEGACY_KB_REGISTRY", tmp_path / "storage" / "kb"
    )
    BrainRegistry.reset_for_tests()
    KBManager.reset_for_tests()
    BrainRegistry.instance().bootstrap()
    payload = json.loads(_tool_knowledge_search({"query": "anything"}))
    assert payload["ok"] is True
    assert payload["disabled"] is True
    assert payload["hits"] == []
    KBManager.reset_for_tests()
