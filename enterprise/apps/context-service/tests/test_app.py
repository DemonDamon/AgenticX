"""统一上下文服务的接口契约测试。不联网：embedding 用确定性桩，LLM 用 monkeypatch。

覆盖链路：token 鉴权 → ingest → search(L0) → read(L1) → compile → wiki/page，
以及增量跳过（SP31）与路径穿越拒绝。
"""

from __future__ import annotations

import hashlib
from pathlib import Path
from typing import List

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("chromadb")

import agenticx.brain.wiki_compiler as wiki_compiler_mod  # noqa: E402
from context_service.app import create_app  # noqa: E402
from context_service.config import Settings  # noqa: E402

TOKEN = "t0ken"

LONG_DOC = (
    "# 赔付制度\n\n"
    + ("一般货物按运费的三倍进行赔付，最高不超过申报价值。" * 60)
    + "\n\n未保价货物按运费的三倍赔付，保价货物按申报价值赔付。\n"
)

WIKI_PAGE_BLOCK = (
    "===FILE: wiki/concepts/赔付制度.md===\n"
    "---\ntitle: 赔付制度\ntype: concept\ndescription: 赔付的一般标准\n"
    "sources:\n  - pay-rules.md\n---\n\n"
    "# 赔付制度\n\n## 要点\n\n"
    "- 未保价货物按运费三倍赔付（来源: pay-rules.md）\n"
    "- 保价货物按申报价值赔付（来源: pay-rules.md）\n\n"
    "## 来源\n\n- pay-rules.md\n"
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


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        internal_token=TOKEN,
        storage_root=tmp_path / "context_data",
        embedding_provider="ollama",
        embedding_model="bge-m3",
        embedding_dim=8,
        embedding_base_url="http://localhost:11434",
        wiki_provider="",
        wiki_model="",
        default_top_k=3,
    )


def _auth() -> dict[str, str]:
    return {"x-agx-internal-token": TOKEN}


@pytest.fixture()
def client(tmp_path: Path) -> TestClient:
    app = create_app(_settings(tmp_path))
    # KBRuntime 的 embedding 懒初始化：直接换成确定性桩，检索不联网。
    app.state.runtime._embedding_provider = _DeterministicEmbedding()  # type: ignore[attr-defined]
    return TestClient(app)


# --------------------------------------------------------------------------- #
# auth & surface                                                              #
# --------------------------------------------------------------------------- #


def test_healthz_needs_no_token(tmp_path: Path):
    assert TestClient(create_app(_settings(tmp_path))).get("/healthz").status_code == 200


def test_every_context_route_requires_the_internal_token(client: TestClient):
    assert client.post("/context/ingest", json={"name": "a", "text": "x"}).status_code == 401
    assert client.post("/context/compile", json={"name": "a"}).status_code == 401
    assert client.post("/context/search", json={"query": "q"}).status_code == 401
    assert client.post("/context/read", json={"hit_id": "h"}).status_code == 401
    assert client.get("/context/wiki/page", params={"path": "wiki/x.md"}).status_code == 401


def test_wrong_token_is_rejected(client: TestClient):
    res = client.post(
        "/context/ingest",
        json={"name": "a", "text": "x"},
        headers={"x-agx-internal-token": "t0keN"},
    )
    assert res.status_code == 401


def test_settings_refuse_to_start_without_a_token(monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("CONTEXT_SERVICE_INTERNAL_TOKEN", raising=False)
    monkeypatch.delenv("CONTEXT_SERVICE_INTERNAL_TOKEN_FILE", raising=False)
    with pytest.raises(RuntimeError, match="refusing to start unauthenticated"):
        Settings.from_env()


# --------------------------------------------------------------------------- #
# ingest → search(L0) → read(L1)                                              #
# --------------------------------------------------------------------------- #


def test_ingest_rejects_bad_names_and_empty_text(client: TestClient):
    assert (
        client.post(
            "/context/ingest", json={"name": "../escape", "text": "x"}, headers=_auth()
        ).status_code
        == 400
    )
    assert (
        client.post("/context/ingest", json={"name": "ok", "text": "  "}, headers=_auth()).status_code
        == 400
    )


def test_search_requires_query(client: TestClient):
    assert client.post("/context/search", json={"query": " "}, headers=_auth()).status_code == 400


def test_l0_search_and_l1_read_roundtrip(client: TestClient):
    res = client.post(
        "/context/ingest", json={"name": "pay-rules", "text": LONG_DOC}, headers=_auth()
    )
    assert res.status_code == 200, res.text
    assert res.json()["ok"] is True

    res = client.post("/context/search", json={"query": "未保价货物 赔付"}, headers=_auth())
    assert res.status_code == 200
    payload = res.json()
    assert payload["ok"] is True
    assert payload["hits"], "seeded doc must be retrievable"

    hit = payload["hits"][0]
    # L0 契约：短摘录 + 可读全文提示。摘录锚定查询关键词之一（首个能在 chunk
    # 中定位到的关键词——stub 检索召回的段落里"未保价"出现在尾部，窗口可能
    # 锚在"货物"上，这同样是正确的关键词锚定）。
    assert len(hit["text"]) <= 280
    assert any(k in hit["text"] for k in ("未保价", "货物", "赔付"))
    assert "hit_id" in hit["read_full_text"]

    # L1：按需取全文，比摘录长得多
    hit_id = hit["id"]
    res = client.post("/context/read", json={"hit_id": hit_id}, headers=_auth())
    assert res.status_code == 200
    full = res.json()
    assert full["ok"] is True
    assert len(full["text"]) > len(hit["text"])
    assert "三倍" in full["text"]


def test_read_unknown_hit_is_404(client: TestClient):
    res = client.post(
        "/context/read", json={"hit_id": "doc_missing::000001"}, headers=_auth()
    )
    assert res.status_code == 404
    assert "search" in res.json()["detail"]


# --------------------------------------------------------------------------- #
# compile → wiki/page（SP31 产物共享）                                        #
# --------------------------------------------------------------------------- #


def _stub_llm(monkeypatch: pytest.MonkeyPatch) -> dict:
    """把 wiki 编译的 LLM 换成桩：第 1 次调用出分析 JSON，第 2 次出页面块。

    两个 prompt 都含 “analysis” 字样，用文本匹配判方向不可靠——编译器固定
    先分析后生成，按调用顺序判定。
    """
    state = {"calls": 0}

    def _fake_llm(_messages, **_kwargs):
        state["calls"] += 1
        if state["calls"] % 2 == 1:
            return '{"entities": ["赔付"], "concepts": ["赔付制度"]}'
        return WIKI_PAGE_BLOCK

    monkeypatch.setattr(wiki_compiler_mod, "_invoke_llm", _fake_llm)
    return state


def test_compile_produces_shared_wiki_page(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    client.post("/context/ingest", json={"name": "pay-rules", "text": LONG_DOC}, headers=_auth())
    _stub_llm(monkeypatch)

    res = client.post("/context/compile", json={"name": "pay-rules"}, headers=_auth())
    assert res.status_code == 200, res.text
    payload = res.json()
    assert payload["ok"] is True, payload
    assert any("赔付制度" in p for p in payload["written"])

    res = client.get(
        "/context/wiki/page",
        params={"path": "wiki/concepts/赔付制度.md"},
        headers=_auth(),
    )
    assert res.status_code == 200
    page = res.json()
    assert page["ok"] is True
    assert "来源: pay-rules.md" in page["content"]


def test_compile_skips_unchanged_document_without_llm(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    client.post("/context/ingest", json={"name": "pay-rules", "text": LONG_DOC}, headers=_auth())
    _stub_llm(monkeypatch)
    first = client.post("/context/compile", json={"name": "pay-rules"}, headers=_auth()).json()
    assert first["ok"] is True
    assert any("赔付制度" in p for p in first["written"])

    # 第二次编译同一文档：不该再触发任何 LLM 调用（SP31 输入指纹跳过）。
    calls = {"n": 0}

    def _fail_llm(*_args, **_kwargs):
        calls["n"] += 1
        raise AssertionError("incremental compile must not call the LLM")

    monkeypatch.setattr(wiki_compiler_mod, "_invoke_llm", _fail_llm)
    second = client.post("/context/compile", json={"name": "pay-rules"}, headers=_auth()).json()
    assert second["ok"] is True
    assert "未变化" in (second.get("skipped_reason") or "")
    assert calls["n"] == 0


def test_compile_unknown_document_404(client: TestClient):
    assert (
        client.post("/context/compile", json={"name": "ghost"}, headers=_auth()).status_code == 404
    )


def test_wiki_page_rejects_path_traversal(client: TestClient):
    assert (
        client.get("/context/wiki/page", params={"path": "../secret.md"}, headers=_auth()).status_code
        == 400
    )
    assert client.get("/context/wiki/page", params={"path": ""}, headers=_auth()).status_code == 400
