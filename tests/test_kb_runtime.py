"""Unit tests for the Stage-1 KB runtime and contracts.

Plan-Id: machi-kb-stage1-local-mvp
Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md

These tests exercise the runtime with a mock embedding provider and a tmp
chroma directory. They must run without requiring Ollama or any network
dependency.
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
    KBError,
    KBManager,
    KBRuntime,
    RetrievalSpec,
    VectorStoreSpec,
)


# --------------------------------------------------------------------------- #
# helpers                                                                     #
# --------------------------------------------------------------------------- #


class _DeterministicEmbedding:
    """Hash-based embedding provider — identical text always hashes the same,
    different tokens diverge, so semantic searches can still rank meaningfully."""

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
            # l2 normalize to keep chroma distances meaningful
            norm = sum(v * v for v in buckets) ** 0.5
            if norm == 0:
                buckets[0] = 1.0
                norm = 1.0
            vectors.append([v / norm for v in buckets])
        return vectors

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return self.embed(texts)


def _make_config(tmp_path: Path, dim: int = 8) -> KBConfig:
    return KBConfig(
        enabled=True,
        vector_store=VectorStoreSpec(
            backend="chroma",
            path=str(tmp_path / "chroma"),
            collection="test",
        ),
        embedding=EmbeddingSpec(provider="ollama", model="bge-m3", dim=dim),
        chunking=ChunkingSpec(strategy="recursive", chunk_size=200, chunk_overlap=20),
        file_filters=FileFilterSpec(extensions=[".md", ".txt"], max_file_size_mb=10),
        retrieval=RetrievalSpec(top_k=3),
    )


def _build_runtime(tmp_path: Path, dim: int = 8) -> KBRuntime:
    runtime = KBRuntime(config=_make_config(tmp_path, dim=dim), registry_dir=tmp_path / "kb")
    # Replace the lazy embedding factory with a deterministic test double.
    runtime._embedding_provider = _DeterministicEmbedding(dim=dim)  # type: ignore[attr-defined]
    return runtime


# --------------------------------------------------------------------------- #
# contracts                                                                   #
# --------------------------------------------------------------------------- #


def test_kbconfig_roundtrip_defaults():
    cfg = KBConfig.from_dict(None)
    assert cfg.vector_store.backend == "chroma"
    assert cfg.embedding.provider == "ollama"
    assert cfg.embedding.model == "bge-m3"
    assert cfg.chunking.strategy == "recursive"
    assert ".md" in cfg.file_filters.extensions
    assert ".pdf" in cfg.file_filters.extensions
    assert ".docx" in cfg.file_filters.extensions
    assert ".pptx" in cfg.file_filters.extensions
    assert ".html" in cfg.file_filters.extensions
    assert ".json" in cfg.file_filters.extensions
    assert cfg.retrieval.mode == "auto"

    as_dict = cfg.to_dict()
    cfg2 = KBConfig.from_dict(as_dict)
    assert cfg2.to_dict() == as_dict


def test_kbconfig_autoupgrades_legacy_extension_allowlist():
    """Configs persisted by the pre-LiteParse build must auto-widen on load.

    Users who left the old default (.md/.txt/.pdf/.docx) should not have to
    edit YAML to get .doc/.ppt/.xls*/image OCR support. Any list that differs
    from that exact legacy set is treated as intentional and left untouched.
    """

    upgraded = KBConfig.from_dict({
        "file_filters": {"extensions": [".md", ".txt", ".pdf", ".docx"], "max_file_size_mb": 100}
    })
    assert ".doc" in upgraded.file_filters.extensions
    assert ".png" in upgraded.file_filters.extensions
    assert ".xlsx" in upgraded.file_filters.extensions
    assert len(upgraded.file_filters.extensions) > 4

    preserved = KBConfig.from_dict({
        "file_filters": {"extensions": [".md", ".txt"], "max_file_size_mb": 10}
    })
    assert preserved.file_filters.extensions == [".md", ".txt"]


def test_kbconfig_embedding_fingerprint_detects_change():
    a = KBConfig.from_dict({"embedding": {"provider": "openai", "model": "m", "dim": 768}})
    b = KBConfig.from_dict({"embedding": {"provider": "openai", "model": "m2", "dim": 768}})
    assert a.embedding_fingerprint() != b.embedding_fingerprint()


def test_kbconfig_retrieval_mode_validation():
    cfg = KBConfig.from_dict({"retrieval": {"mode": "always", "top_k": 7}})
    assert cfg.retrieval.mode == "always"
    assert cfg.retrieval.top_k == 7

    fallback = KBConfig.from_dict({"retrieval": {"mode": "invalid"}})
    assert fallback.retrieval.mode == "auto"

    # Legacy "manual" mode (pre-simplification) must silently migrate to "auto"
    # so existing config.yaml files continue to round-trip without user edits.
    migrated = KBConfig.from_dict({"retrieval": {"mode": "manual"}})
    assert migrated.retrieval.mode == "auto"


# --------------------------------------------------------------------------- #
# runtime end-to-end                                                          #
# --------------------------------------------------------------------------- #


def test_register_rejects_unsupported_extension(tmp_path: Path):
    runtime = _build_runtime(tmp_path)
    weird = tmp_path / "stuff.xyz"
    weird.write_text("whatever")
    with pytest.raises(KBError):
        runtime.register_document(str(weird))


def test_register_rejects_oversize_file(tmp_path: Path):
    cfg = _make_config(tmp_path)
    # max_file_size_mb is clamped to >= 1MB by the runtime; use a >1MB file to trigger.
    cfg.file_filters = FileFilterSpec(extensions=[".md"], max_file_size_mb=1)
    runtime = KBRuntime(config=cfg, registry_dir=tmp_path / "kb")
    runtime._embedding_provider = _DeterministicEmbedding()  # type: ignore[attr-defined]
    path = tmp_path / "doc.md"
    path.write_bytes(b"a" * (1024 * 1024 + 128))  # 1MB + 128B, just above the cap
    with pytest.raises(KBError):
        runtime.register_document(str(path))


def test_ingest_search_roundtrip(tmp_path: Path):
    runtime = _build_runtime(tmp_path)
    doc_path = tmp_path / "notes.md"
    doc_path.write_text(
        "chroma is a vector database\n\n"
        "agenticx provides readers and chunkers\n\n"
        "knowledge search returns top-k chunks"
    )
    doc = runtime.register_document(str(doc_path))
    report = runtime.ingest_document(doc.id)
    assert report.failed == 0, report.reasons
    assert report.success == 1

    stored = runtime.get_document(doc.id)
    assert stored is not None
    assert stored.status == KBDocumentStatus.DONE
    assert stored.chunks > 0

    hits = runtime.search("chroma vector", top_k=3)
    assert hits, "expected at least one hit"
    assert hits[0].source.kind == "local"
    assert hits[0].source.uri == str(doc_path.resolve())
    assert hits[0].metadata.get("document_id") == doc.id


def test_ingest_strips_none_valued_metadata(tmp_path: Path, monkeypatch):
    """Chroma rejects metadata values that are None:
        "Expected metadata value to be a str, int, float or bool, got None".
    Many PDF/DOCX chunkers don't emit char offsets, so start_index/end_index
    can be None. Regression test: ingestion must succeed by dropping those
    keys, not fail the write with NoneType errors.
    """
    from agenticx.studio.kb import runtime as rt

    def _chunks_with_none_offsets(**_kwargs):
        return [
            {"text": "one", "chunk_index": 0, "start_index": None, "end_index": None},
            {"text": "two", "chunk_index": 1, "start_index": None, "end_index": None},
        ]

    monkeypatch.setattr(rt, "_chunk_text", _chunks_with_none_offsets)

    runtime = _build_runtime(tmp_path)
    doc_path = tmp_path / "has-none-offsets.md"
    doc_path.write_text("body irrelevant — chunker stub replaces splitting")
    doc = runtime.register_document(str(doc_path))

    report = runtime.ingest_document(doc.id)

    assert report.failed == 0, report.reasons
    assert report.success == 1

    stored = runtime.get_document(doc.id)
    assert stored is not None
    assert stored.status == KBDocumentStatus.DONE
    assert stored.chunks == 2


def test_preview_chunks_does_not_write_store(tmp_path: Path):
    runtime = _build_runtime(tmp_path)
    doc_path = tmp_path / "preview.md"
    doc_path.write_text("one two three four five six seven eight nine ten")
    chunks = runtime.preview_chunks(str(doc_path), chunking=ChunkingSpec(chunk_size=24, chunk_overlap=4))
    assert chunks
    assert all("text" in c and isinstance(c["text"], str) for c in chunks)
    assert runtime.stats()["doc_count"] == 0


def test_delete_document_purges_registry(tmp_path: Path):
    runtime = _build_runtime(tmp_path)
    doc_path = tmp_path / "del.md"
    doc_path.write_text("content to be removed soon enough")
    doc = runtime.register_document(str(doc_path))
    runtime.ingest_document(doc.id)
    assert runtime.get_document(doc.id) is not None
    assert runtime.delete_document(doc.id) is True
    assert runtime.get_document(doc.id) is None
    # deleting a second time must not throw
    assert runtime.delete_document(doc.id) is False


def test_embedding_dim_mismatch_is_caught(tmp_path: Path):
    # Config says dim=8 but provider returns dim=4 — should surface as KBError.
    runtime = _build_runtime(tmp_path, dim=8)
    runtime._embedding_provider = _DeterministicEmbedding(dim=4)  # type: ignore[attr-defined]
    doc_path = tmp_path / "mismatch.md"
    doc_path.write_text("abc def ghi")
    doc = runtime.register_document(str(doc_path))
    report = runtime.ingest_document(doc.id)
    assert report.failed == 1
    assert any("dim mismatch" in r.lower() or "dim" in r.lower() for r in report.reasons)
    stored = runtime.get_document(doc.id)
    assert stored is not None
    assert stored.status == KBDocumentStatus.FAILED


def test_update_config_sets_rebuild_required(tmp_path: Path):
    runtime = _build_runtime(tmp_path)
    doc_path = tmp_path / "rebuild.md"
    doc_path.write_text("rebuild detection smoke test")
    doc = runtime.register_document(str(doc_path))
    runtime.ingest_document(doc.id)

    new_config = _make_config(tmp_path)
    new_config.embedding = EmbeddingSpec(provider="openai", model="text-embedding-3", dim=8)
    result = runtime.update_config(new_config)
    assert result["rebuild_required"] is True
    assert runtime.rebuild_required() is True


# --------------------------------------------------------------------------- #
# manager                                                                     #
# --------------------------------------------------------------------------- #


def test_kbmanager_roundtrips_yaml(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    KBManager.reset_for_tests()
    cfg_path = tmp_path / "config.yaml"
    monkeypatch.setenv("HOME", str(tmp_path))
    manager = KBManager(config_path=str(cfg_path))
    # initial config is defaults; not enabled yet
    assert manager.read_config().enabled is False

    # enabling and persisting round-trips through YAML
    new_cfg = manager.read_config()
    new_cfg.enabled = True
    new_cfg.vector_store = VectorStoreSpec(backend="chroma", path=str(tmp_path / "vdb"), collection="x")
    result = manager.write_config(new_cfg)
    assert "rebuild_required" in result
    assert cfg_path.exists()
    reloaded = KBManager(config_path=str(cfg_path))
    assert reloaded.read_config().enabled is True
    KBManager.reset_for_tests()


# --------------------------------------------------------------------------- #
# jobs                                                                        #
# --------------------------------------------------------------------------- #


def test_job_registry_runs_ingest(tmp_path: Path):
    runtime = _build_runtime(tmp_path)
    doc_path = tmp_path / "async.md"
    doc_path.write_text("job registry smoke test one two three")
    doc = runtime.register_document(str(doc_path))

    from agenticx.studio.kb.jobs import JobRegistry, IngestJobStatus

    registry = JobRegistry(max_workers=1)
    job = registry.submit_ingest(runtime, doc.id)
    # Wait for completion by polling — the executor is sync underneath.
    import time

    deadline = time.time() + 15
    while time.time() < deadline:
        current = registry.get(job.id)
        if current and current.status in {IngestJobStatus.DONE, IngestJobStatus.FAILED}:
            break
        time.sleep(0.1)
    final = registry.get(job.id)
    assert final is not None
    assert final.status == IngestJobStatus.DONE
    assert final.progress == 1.0


def test_ingest_progress_callback_reports_embedding_percentage(tmp_path: Path):
    runtime = _build_runtime(tmp_path)
    runtime._config.chunking = ChunkingSpec(  # type: ignore[attr-defined]
        strategy="recursive",
        chunk_size=32,
        chunk_overlap=0,
    )
    doc_path = tmp_path / "progress.md"
    doc_path.write_text(" ".join(f"token{i}" for i in range(600)))
    doc = runtime.register_document(str(doc_path))

    events: list[tuple[str, str, float | None]] = []

    def _progress(status, message, stage_progress=None):
        status_value = str(getattr(status, "value", status))
        events.append((status_value, message, stage_progress))

    report = runtime.ingest_document(doc.id, progress_cb=_progress)
    assert report.failed == 0, report.reasons

    embedding_events = [e for e in events if e[0] == KBDocumentStatus.EMBEDDING.value]
    assert embedding_events, "expected embedding stage progress events"
    # First event starts at 0%, and later ones move forward.
    assert embedding_events[0][2] == 0.0
    assert any((e[2] or 0.0) > 0.0 for e in embedding_events[1:])
    assert embedding_events[-1][2] == 1.0
    assert "/" in embedding_events[-1][1]


# --------------------------------------------------------------------------- #
# LiteParse fallback routing                                                  #
# --------------------------------------------------------------------------- #


def test_read_document_text_routes_liteparse_only_exts(tmp_path: Path, monkeypatch):
    """Images and legacy Office formats must be handed to LiteParse."""

    from agenticx.studio.kb import runtime as kb_runtime

    img_path = tmp_path / "scan.png"
    img_path.write_bytes(b"\x89PNG\r\n\x1a\n")  # not a real PNG, but that's fine — we stub
    called: list[Path] = []

    def _fake_liteparse(path):
        called.append(path)
        return "hello from liteparse"

    monkeypatch.setattr(kb_runtime, "_read_with_liteparse", _fake_liteparse)
    text = kb_runtime._read_document_text(str(img_path))
    assert text == "hello from liteparse"
    assert called == [Path(str(img_path)).expanduser()]


def test_read_with_liteparse_raises_when_libreoffice_missing(tmp_path: Path, monkeypatch):
    """Excel/legacy-Office ingest must fail fast with the install hint when
    LibreOffice is absent, rather than bubbling up LiteParse's multi-line JS
    stack trace to the UI."""

    from agenticx.studio.kb import runtime as kb_runtime
    from agenticx.tools.adapters import liteparse as liteparse_mod

    monkeypatch.setattr(
        liteparse_mod.LiteParseAdapter, "is_available", staticmethod(lambda: True)
    )
    monkeypatch.setattr(kb_runtime, "_libreoffice_available", lambda: False)

    xlsx_path = tmp_path / "sheet.xlsx"
    xlsx_path.write_bytes(b"PK\x03\x04")
    with pytest.raises(KBError) as excinfo:
        kb_runtime._read_with_liteparse(xlsx_path)
    message = str(excinfo.value)
    assert "LibreOffice" in message
    assert "brew install --cask libreoffice" in message
    assert ".xlsx" in message


def test_read_with_liteparse_translates_libreoffice_runtime_error(
    tmp_path: Path, monkeypatch
):
    """If upstream check passes but LiteParse still reports missing LO, the
    friendly KBError must replace the raw CLI stack trace."""

    from agenticx.studio.kb import runtime as kb_runtime
    from agenticx.tools.adapters import liteparse as liteparse_mod

    monkeypatch.setattr(
        liteparse_mod.LiteParseAdapter, "is_available", staticmethod(lambda: True)
    )
    monkeypatch.setattr(kb_runtime, "_libreoffice_available", lambda: True)

    async def _fake_parse_to_text(self, path):
        raise RuntimeError(
            "liteparse parse failed: Error: Conversion failed: "
            "LibreOffice is not installed."
        )

    monkeypatch.setattr(
        liteparse_mod.LiteParseAdapter, "parse_to_text", _fake_parse_to_text
    )

    xlsx_path = tmp_path / "sheet.xlsx"
    xlsx_path.write_bytes(b"PK\x03\x04")
    with pytest.raises(KBError) as excinfo:
        kb_runtime._read_with_liteparse(xlsx_path)
    message = str(excinfo.value)
    assert "LibreOffice" in message
    assert "brew install --cask libreoffice" in message


def test_read_with_liteparse_raises_when_cli_missing(tmp_path: Path, monkeypatch):
    """Without the LiteParse CLI, the KBError must name the install command."""

    from agenticx.studio.kb import runtime as kb_runtime
    from agenticx.tools.adapters import liteparse as liteparse_mod

    monkeypatch.setattr(
        liteparse_mod.LiteParseAdapter, "is_available", staticmethod(lambda: False)
    )

    img_path = tmp_path / "scan.jpg"
    img_path.write_bytes(b"\xff\xd8\xff")
    with pytest.raises(KBError) as excinfo:
        kb_runtime._read_with_liteparse(img_path)
    message = str(excinfo.value)
    assert "@llamaindex/liteparse" in message
    assert ".jpg" in message
