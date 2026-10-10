"""企业统一上下文服务：一次编译，全公司 agent 共用（SP31 产物 + SP32 分级读取）。

窄服务。刻意不连租户库——写库由 admin-console 编排；这里只回答「企业知识库里有什么、
哪段相关、全文是什么」。复用核心仓引擎（wiki_compiler / KBRuntime / 分级读取），
不在企业侧重写一个更弱的检索器。

接口一览（除 healthz 外全部需要 x-agx-internal-token）：

- GET  /healthz                探活
- POST /context/ingest         文档入库（写盘 + 向量索引）
- POST /context/compile        把已入库文档编译进共享 wiki（增量跳过，SP31）
- POST /context/search         L0 紧凑索引：每条 hit 只带查询相关摘录（SP32）
- POST /context/read           L1 按需取单条全文（SP32）
- GET  /context/wiki/page      读共享 wiki 编译产物页面
"""

from __future__ import annotations

import logging
import re
import secrets
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field

from .config import Settings

logger = logging.getLogger("context-service")

_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
"""入库文档名只允许这套字符：名字会直接拼进文件路径，宽松一分就是路径穿越。"""


class IngestRequest(BaseModel):
    name: str
    text: str


class CompileRequest(BaseModel):
    name: str


class SearchRequest(BaseModel):
    query: str
    top_k: Optional[int] = None


class ReadRequest(BaseModel):
    hit_id: str


def _build_kb_config(settings: Settings):
    from agenticx.studio.kb.contracts import (
        ChunkingSpec,
        EmbeddingSpec,
        FileFilterSpec,
        KBConfig,
        RetrievalSpec,
        VectorStoreSpec,
    )

    return KBConfig(
        enabled=True,
        vector_store=VectorStoreSpec(
            backend="chroma",
            path=str(settings.storage_root / "chroma"),
            collection="enterprise_kb",
        ),
        embedding=EmbeddingSpec(
            provider=settings.embedding_provider,
            model=settings.embedding_model,
            dim=settings.embedding_dim,
            base_url=settings.embedding_base_url,
        ),
        chunking=ChunkingSpec(strategy="recursive", chunk_size=800, chunk_overlap=80),
        file_filters=FileFilterSpec(extensions=[".md", ".txt"], max_file_size_mb=50),
        retrieval=RetrievalSpec(top_k=settings.default_top_k),
    )


def create_app(settings: Settings | None = None) -> FastAPI:
    resolved = settings or Settings.from_env()
    app = FastAPI(title="AgenticX Context Service", docs_url=None, redoc_url=None)

    storage = resolved.storage_root.expanduser().resolve()
    documents_dir = storage / "documents"
    documents_dir.mkdir(parents=True, exist_ok=True)

    from agenticx.brain.search import (
        _HIT_FULLTEXT_CACHE,
        make_query_snippet,
        read_kb_hit,
    )
    from agenticx.brain.wiki_compiler import WikiCompiler
    from agenticx.studio.kb.runtime import KBRuntime

    runtime = KBRuntime(
        _build_kb_config(resolved),
        registry_dir=storage / "kb",
        brain_storage_root=storage,
    )
    compiler = WikiCompiler(storage)
    # 挂到 app.state：编排测试/运维脚本可以直接替换 embedding provider 或预热
    # 向量库，不需要为测试开后门接口。
    app.state.runtime = runtime
    app.state.compiler = compiler

    def require_internal_token(
        x_agx_internal_token: str | None = Header(default=None),
    ) -> None:
        # 定长比较，别把 token 是否前缀匹配泄漏成时间差。
        if not x_agx_internal_token or not secrets.compare_digest(
            x_agx_internal_token, resolved.internal_token
        ):
            raise HTTPException(status_code=401, detail="unauthorized")

    def _resolve_doc_path(name: str) -> Path:
        clean = name.strip()
        if not _SAFE_NAME_RE.fullmatch(clean):
            raise HTTPException(status_code=400, detail="invalid document name")
        return (documents_dir / f"{clean}.md").resolve()

    @app.get("/healthz")
    def healthz() -> dict[str, str]:
        # 编排器探活不该持有凭据，也不该从探活里泄漏任何东西。
        return {"status": "ok"}

    @app.post("/context/ingest", dependencies=[Depends(require_internal_token)])
    def ingest(request: IngestRequest) -> dict[str, Any]:
        """文档入库：写盘 + 向量索引。wiki 编译是另一个接口（慢、走 LLM）。"""
        if not request.text.strip():
            raise HTTPException(status_code=400, detail="text must not be empty")
        path = _resolve_doc_path(request.name)
        path.write_text(request.text, encoding="utf-8")
        try:
            doc = runtime.register_document(str(path))
        except Exception as exc:  # noqa: BLE001 - surface as 400, not a stack trace
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        report = runtime.ingest_document(doc.id)
        return {
            "ok": report.failed == 0 and report.cancelled == 0,
            "document_id": doc.id,
            "name": request.name,
            "success": report.success,
            "failed": report.failed,
            "reasons": report.reasons,
        }

    @app.post("/context/compile", dependencies=[Depends(require_internal_token)])
    def compile_doc(request: CompileRequest) -> dict[str, Any]:
        """把已入库文档编译进共享 wiki。未变文档零 LLM 跳过（SP31 增量指纹）。"""
        path = _resolve_doc_path(request.name)
        if not path.is_file():
            raise HTTPException(status_code=404, detail=f"document not ingested: {request.name}")
        result = compiler.compile_source(
            source_path=str(path),
            source_text=path.read_text(encoding="utf-8"),
            provider_name=resolved.wiki_provider or None,
            model_name=resolved.wiki_model or None,
        )
        return {
            "ok": bool(result.ok),
            "written": result.written,
            "skipped": result.skipped,
            "skipped_reason": result.skipped_reason,
            "error": result.error,
        }

    @app.post("/context/search", dependencies=[Depends(require_internal_token)])
    def search(request: SearchRequest) -> dict[str, Any]:
        """L0 紧凑索引（SP32）：每条 hit 只带查询相关摘录 + read 提示。

        企业 agent 先拿这份小上下文判断相关性与引用，再用 /context/read
        按需取真正需要的全文——而不是把 top_k 条全文整包吞进上下文。
        """
        query = request.query.strip()
        if not query:
            raise HTTPException(status_code=400, detail="query is required")
        top_k = max(1, min(20, int(request.top_k or resolved.default_top_k)))
        hits = runtime.search(query, top_k=top_k)
        flat: List[Dict[str, Any]] = []
        for hit in hits:
            item = hit.to_dict()
            item["brain_id"] = "enterprise"
            _HIT_FULLTEXT_CACHE.put("enterprise", item)
            compact = dict(item)
            compact["text"] = make_query_snippet(str(item.get("text") or ""), query)
            compact["read_full_text"] = "POST /context/read {\"hit_id\": \"%s\"}" % (
                item.get("id") or ""
            )
            flat.append(compact)
        return {
            "ok": True,
            "hits": flat,
            "used_top_k": len(flat),
            "hint": (
                "结果为紧凑摘要。需要某条完整段落时调用 /context/read 取该条全文；"
                "编译产物页面可通过 /context/wiki/page 读取。"
            ),
        }

    @app.post("/context/read", dependencies=[Depends(require_internal_token)])
    def read(request: ReadRequest) -> dict[str, Any]:
        """L1 按需全文（SP32）。只服务最近一次 search 缓存过的 hit。"""
        payload = read_kb_hit(request.hit_id, brain_id="enterprise")
        if not payload.get("ok"):
            raise HTTPException(status_code=404, detail=str(payload.get("error")))
        return payload

    @app.get("/context/wiki/page", dependencies=[Depends(require_internal_token)])
    def wiki_page(path: str = "") -> dict[str, Any]:
        """读共享 wiki 编译产物页面（SP31 契约：frontmatter + 要点 + 矛盾 + 来源）。"""
        rel = path.strip().lstrip("/").replace("\\", "/")
        if not rel or ".." in rel.split("/"):
            raise HTTPException(status_code=400, detail="invalid page path")
        target = (storage / rel).resolve()
        try:
            target.relative_to(storage)
        except ValueError:
            raise HTTPException(status_code=400, detail="invalid page path") from None
        if not target.is_file():
            raise HTTPException(status_code=404, detail="page not found")
        return {"ok": True, "path": rel, "content": target.read_text(encoding="utf-8")}

    return app
