"""API integration tests for /api/kb/*.

Plan-Id: machi-kb-stage1-local-mvp
Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md

The tests exercise the FastAPI app through ``starlette.testclient.TestClient``
with a tmp-dir backed ``KBManager`` and a hashed embedding provider, so the
server spins up entirely offline.
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import List

import pytest

pytest.importorskip("chromadb")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

from agenticx.studio.kb import (  # noqa: E402
    ChunkingSpec,
    EmbeddingSpec,
    FileFilterSpec,
    KBConfig,
    KBManager,
    RetrievalSpec,
    VectorStoreSpec,
)
from agenticx.studio.kb.routes import register_kb_routes  # noqa: E402


class _DeterministicEmbedding:
    def __init__(self, dim: int = 8) -> None:
        self.dim = dim

    def embed(self, texts: List[str]) -> List[List[float]]:
        out: List[List[float]] = []
        for text in texts:
            buckets = [0.0] * self.dim
            for token in (text or "").lower().split():
                digest = hashlib.md5(token.encode("utf-8")).digest()
                for i in range(self.dim):
                    buckets[i] += digest[i] / 255.0
            norm = sum(v * v for v in buckets) ** 0.5
            if norm == 0:
                buckets[0] = 1.0
                norm = 1.0
            out.append([v / norm for v in buckets])
        return out

    def embed_documents(self, texts: List[str]) -> List[List[float]]:
        return self.embed(texts)


@pytest.fixture
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    KBManager.reset_for_tests()
    cfg_path = tmp_path / "config.yaml"
    # Pre-populate with an enabled config so routes operate against tmp storage.
    initial = KBConfig(
        enabled=True,
        vector_store=VectorStoreSpec(
            backend="chroma", path=str(tmp_path / "chroma"), collection="test"
        ),
        embedding=EmbeddingSpec(provider="ollama", model="bge-m3", dim=8),
        chunking=ChunkingSpec(strategy="recursive", chunk_size=200, chunk_overlap=20),
        file_filters=FileFilterSpec(extensions=[".md", ".txt"], max_file_size_mb=5),
        retrieval=RetrievalSpec(top_k=3),
    )

    # Manually seed the singleton so all routes share this instance.
    manager = KBManager(config_path=str(cfg_path))
    manager._runtime._config = initial  # type: ignore[attr-defined]
    manager._runtime._embedding_provider = _DeterministicEmbedding()  # type: ignore[attr-defined]
    # Reroute runtime's registry to a tmp dir so nothing lands in ~/.agenticx
    from agenticx.studio.kb.runtime import _DocumentRegistry  # type: ignore

    tmp_registry_dir = tmp_path / "kb"
    tmp_registry_dir.mkdir(parents=True, exist_ok=True)
    manager._runtime._registry = _DocumentRegistry(tmp_registry_dir / "documents.json")  # type: ignore[attr-defined]
    manager._runtime._state_path = tmp_registry_dir / "state.json"  # type: ignore[attr-defined]
    # Write the initial config to disk so GET/PUT round-trip through YAML works.
    manager.write_config(initial)
    # Reinstall the stub embedding since write_config resets lazy state.
    manager._runtime._embedding_provider = _DeterministicEmbedding()  # type: ignore[attr-defined]

    KBManager._instance = manager  # type: ignore[attr-defined]

    app = FastAPI()
    register_kb_routes(app)
    yield TestClient(app)
    KBManager.reset_for_tests()


def _wait_for_job(client: TestClient, job_id: str, *, timeout: float = 15.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        resp = client.get(f"/api/kb/jobs/{job_id}")
        assert resp.status_code == 200
        job = resp.json()["job"]
        if job["status"] in {"done", "failed"}:
            return job
        time.sleep(0.1)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")


# --------------------------------------------------------------------------- #
# config round-trip                                                           #
# --------------------------------------------------------------------------- #


def test_get_config_returns_defaults(client: TestClient):
    resp = client.get("/api/kb/config")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["config"]["enabled"] is True
    assert body["config"]["embedding"]["model"] == "bge-m3"
    assert "stats" in body


def test_put_config_detects_rebuild(client: TestClient):
    resp = client.get("/api/kb/config")
    cfg = resp.json()["config"]
    # Change the embedding model — but first seed an ingested doc, else rebuild_required is False
    # because runtime hasn't recorded any indexed_fingerprint yet.
    # We do this via the API to stay honest.
    doc_path = Path(cfg["vector_store"]["path"]).parent / "seed.md"
    doc_path.parent.mkdir(parents=True, exist_ok=True)
    doc_path.write_text("seeding the rebuild-required detection path")
    add = client.post("/api/kb/documents", data={"path": str(doc_path)})
    assert add.status_code == 200
    job_id = add.json()["job_id"]
    _wait_for_job(client, job_id)

    cfg["embedding"]["model"] = "text-embedding-3"
    cfg["embedding"]["provider"] = "openai"
    resp = client.put("/api/kb/config", json=cfg)
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["rebuild_required"] is True


# --------------------------------------------------------------------------- #
# documents & jobs                                                            #
# --------------------------------------------------------------------------- #


def test_add_document_by_path_and_search(client: TestClient, tmp_path: Path):
    doc_path = tmp_path / "notes.md"
    doc_path.write_text(
        "chroma is a vector database\n\n"
        "agenticx ships readers and chunkers\n\n"
        "knowledge search returns top chunks"
    )
    resp = client.post("/api/kb/documents", data={"path": str(doc_path)})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["document"]["source_name"] == "notes.md"
    job_id = body["job_id"]

    job = _wait_for_job(client, job_id)
    assert job["status"] == "done"
    assert job["progress"] == 1.0

    list_resp = client.get("/api/kb/documents")
    assert list_resp.status_code == 200
    documents = list_resp.json()["documents"]
    assert any(d["source_name"] == "notes.md" and d["status"] == "done" for d in documents)

    search_resp = client.post("/api/kb/search", json={"query": "chroma vector", "top_k": 3})
    assert search_resp.status_code == 200
    payload = search_resp.json()
    assert payload["hits"], "expected at least one hit"
    assert payload["source"] == "local"
    assert all(h["source"]["kind"] == "local" for h in payload["hits"])


def test_add_document_via_multipart_upload(client: TestClient):
    file_bytes = b"multipart upload body for agenticx knowledge base"
    files = {"file": ("upload.md", file_bytes, "text/markdown")}
    resp = client.post("/api/kb/documents", files=files)
    assert resp.status_code == 200, resp.text
    body = resp.json()
    job = _wait_for_job(client, body["job_id"])
    assert job["status"] == "done"


def test_delete_document_removes_row(client: TestClient, tmp_path: Path):
    doc = tmp_path / "remove-me.md"
    doc.write_text("disposable content")
    add = client.post("/api/kb/documents", data={"path": str(doc)})
    job_id = add.json()["job_id"]
    _wait_for_job(client, job_id)
    doc_id = add.json()["document"]["id"]

    resp = client.delete(f"/api/kb/documents/{doc_id}")
    assert resp.status_code == 200
    assert resp.json()["document_id"] == doc_id

    # deleting again yields 404
    resp2 = client.delete(f"/api/kb/documents/{doc_id}")
    assert resp2.status_code == 404


def test_list_jobs_returns_all_tracked(client: TestClient, tmp_path: Path):
    """GET /api/kb/jobs must expose every job so the UI can re-hydrate
    live progress after the settings panel is closed and reopened."""
    doc = tmp_path / "list-jobs.md"
    doc.write_text("list-jobs source for polling rehydration")
    add = client.post("/api/kb/documents", data={"path": str(doc)})
    assert add.status_code == 200
    job_id = add.json()["job_id"]
    doc_id = add.json()["document"]["id"]

    resp = client.get("/api/kb/jobs")
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    matching = [j for j in body["jobs"] if j["id"] == job_id]
    assert len(matching) == 1
    assert matching[0]["document_id"] == doc_id

    _wait_for_job(client, job_id)
    # Terminal jobs remain queryable so the UI can collapse them in its
    # post-reload pass without losing the reference.
    resp = client.get("/api/kb/jobs")
    assert resp.status_code == 200
    matching = [j for j in resp.json()["jobs"] if j["id"] == job_id]
    assert len(matching) == 1
    assert matching[0]["status"] == "done"


def test_rebuild_document_creates_new_job(client: TestClient, tmp_path: Path):
    doc = tmp_path / "rebuildable.md"
    doc.write_text("rebuild me please, over and over")
    add = client.post("/api/kb/documents", data={"path": str(doc)})
    doc_id = add.json()["document"]["id"]
    _wait_for_job(client, add.json()["job_id"])

    resp = client.post(f"/api/kb/documents/{doc_id}/rebuild")
    assert resp.status_code == 200
    job_id = resp.json()["job_id"]
    assert job_id != add.json()["job_id"]
    final = _wait_for_job(client, job_id)
    assert final["status"] == "done"


def test_debug_preview_does_not_ingest(client: TestClient, tmp_path: Path):
    doc = tmp_path / "preview-only.md"
    doc.write_text("one two three four five six seven eight nine ten eleven twelve")
    resp = client.post(
        "/api/kb/debug/preview",
        json={"path": str(doc), "chunking": {"chunk_size": 24, "chunk_overlap": 4}},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["ok"] is True
    assert body["count"] >= 1
    assert all("text" in chunk for chunk in body["chunks"])
    # None of this should have registered a document:
    docs = client.get("/api/kb/documents").json()["documents"]
    assert not any(d["source_name"] == "preview-only.md" for d in docs)


def test_search_empty_query_400(client: TestClient):
    resp = client.post("/api/kb/search", json={"query": "   "})
    assert resp.status_code == 400


def test_add_document_rejects_unknown_extension(client: TestClient, tmp_path: Path):
    bad = tmp_path / "script.py"
    bad.write_text("print('hello')")
    resp = client.post("/api/kb/documents", data={"path": str(bad)})
    assert resp.status_code == 400
    assert "extension" in resp.json().get("detail", "").lower() or "unsupported" in resp.json().get(
        "detail", ""
    ).lower()
