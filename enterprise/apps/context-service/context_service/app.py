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
- POST /context/wiki/push      批量入库 wiki 页，可选逐页编译进共享 wiki（SP-F1）
- POST /context/cases/search   案例检索：向量召回 + frontmatter 过滤 + scope 硬过滤（SP-F1）
- GET  /context/cases/get      按 case_id 取案例条目 md 原文（SP-F1）
- GET  /context/wiki/list      共享 wiki 页面相对路径清单（SP-F1）
"""

from __future__ import annotations

import logging
import re
import secrets
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel, Field
import yaml

from .config import Settings

logger = logging.getLogger("context-service")

_SAFE_NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]*$")
"""入库文档名只允许这套字符：名字会直接拼进文件路径，宽松一分就是路径穿越。"""

_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---", re.DOTALL)

_CASE_RECALL_POOL = 20
"""cases/search 的向量召回窗口（runtime.search 的 top_k 硬上限就是 20）。

召回只是手段：宁可多召回再靠 frontmatter 的 case_id 与 scope_filter 过滤，
也不能让非案例文档把向量 top_k 名额占满后真案例一条都进不来。"""


def _parse_frontmatter(text: str) -> Dict[str, Any]:
    """轻量 YAML frontmatter 解析（SP-F1）：只要 --- 之间的字段，返回 dict。

    刻意不 import agenticx.cases.model——那边接口绑定 CaseEntry dataclass，
    服务端保持窄依赖，这里只需要 dict 做 case_id / scope 判定。
    解析失败按「无 frontmatter」处理，调用方自然把它当普通文档。
    """
    m = _FRONTMATTER_RE.match(text or "")
    if not m:
        return {}
    try:
        data = yaml.safe_load(m.group(1))
    except yaml.YAMLError:
        return {}
    return data if isinstance(data, dict) else {}


def _str_dict(raw: Any) -> Dict[str, str]:
    if not isinstance(raw, dict):
        return {}
    return {str(k): str(v) for k, v in raw.items()}


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


class WikiPushPage(BaseModel):
    name: str
    text: str


class WikiPushRequest(BaseModel):
    pages: List[WikiPushPage]
    compile: bool = True


class CaseSearchRequest(BaseModel):
    query: str
    scope_filter: Optional[Dict[str, Any]] = None
    top_k: Optional[int] = None


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
        target = None
        # 两段查找：先按相对 storage（兼容既有调用方），再按相对 wiki/（与 wiki/list 返回一致）
        for base in (storage, storage / "wiki"):
            candidate = (base / rel).resolve()
            try:
                candidate.relative_to(storage)
            except ValueError:
                continue
            if candidate.is_file():
                target = candidate
                break
        if target is None:
            raise HTTPException(status_code=404, detail="page not found")
        return {"ok": True, "path": rel, "content": target.read_text(encoding="utf-8")}

    @app.post("/context/wiki/push", dependencies=[Depends(require_internal_token)])
    def wiki_push(request: WikiPushRequest) -> dict[str, Any]:
        """批量入库 wiki 页（SP-F1）：逐页 ingest，compile=true 时逐页编译进共享 wiki。

        单页失败只记 errors 不中断整体——成员推一整批项目页面时，一页坏
        不该让整批回滚重来。ingest 失败的页不再尝试 compile（编译读的是
        同一份盘上原文，索引都没建成，编译大概率也是白跑）。
        """
        ingested = 0
        compiled = 0
        errors: List[Dict[str, str]] = []
        for page in request.pages:
            try:
                if not page.text.strip():
                    raise ValueError("text must not be empty")
                path = _resolve_doc_path(page.name)
                path.write_text(page.text, encoding="utf-8")
                doc = runtime.register_document(str(path))
                report = runtime.ingest_document(doc.id)
                if report.failed or report.cancelled:
                    raise RuntimeError("; ".join(report.reasons) or "ingest failed")
            except HTTPException as exc:
                errors.append({"name": page.name, "error": str(exc.detail)})
                continue
            except Exception as exc:  # noqa: BLE001 - 单页失败记 errors，不中断整批
                errors.append({"name": page.name, "error": str(exc)})
                continue
            ingested += 1
            if not request.compile:
                continue
            try:
                result = compiler.compile_source(
                    source_path=str(path),
                    source_text=page.text,
                    provider_name=resolved.wiki_provider or None,
                    model_name=resolved.wiki_model or None,
                )
                if result.ok:
                    compiled += 1
                else:
                    errors.append({"name": page.name, "error": result.error or "compile failed"})
            except Exception as exc:  # noqa: BLE001 - 同上：单页编译失败不中断整批
                errors.append({"name": page.name, "error": str(exc)})
        return {"ok": not errors, "ingested": ingested, "compiled": compiled, "errors": errors}

    @app.post("/context/cases/search", dependencies=[Depends(require_internal_token)])
    def cases_search(request: CaseSearchRequest) -> dict[str, Any]:
        """案例条目检索（SP-F1）：向量召回只是手段，case 判定靠 frontmatter。

        召回窗口取 runtime 上限，对每个 hit 回读 documents_dir 原文，
        frontmatter 含 case_id 的才算案例；scope_filter 硬过滤（键值相等，
        条目缺键保守放行）。同一案例多 chunk 命中只保留最高分一条。
        matched_on = 该条目实际命中了 scope_filter 的哪些键（与本地
        search_cases 的字段级 matched_on 对应的云端语义）。
        """
        query = request.query.strip()
        if not query:
            raise HTTPException(status_code=400, detail="query is required")
        top_k = max(1, min(20, int(request.top_k or resolved.default_top_k)))
        scope_filter = {str(k): v for k, v in (request.scope_filter or {}).items()}

        hits = sorted(
            runtime.search(query, top_k=_CASE_RECALL_POOL),
            key=lambda hit: hit.score,
            reverse=True,
        )
        frontmatter_cache: Dict[str, Dict[str, Any]] = {}
        cases: Dict[str, Dict[str, Any]] = {}
        for hit in hits:
            source = str(hit.metadata.get("source_path") or hit.source.uri or "")
            if not source:
                continue
            path = Path(source)
            try:
                path.resolve().relative_to(documents_dir)
            except ValueError:
                continue  # 只认本服务 documents_dir 下的文档
            if not path.is_file():
                continue
            if source not in frontmatter_cache:
                try:
                    frontmatter_cache[source] = _parse_frontmatter(
                        path.read_text(encoding="utf-8")
                    )
                except OSError:
                    frontmatter_cache[source] = {}
            fm = frontmatter_cache[source]
            case_id = str(fm.get("case_id") or "").strip()
            if not case_id:
                continue  # 召回的是普通文档，不是案例条目
            if case_id in cases:
                continue  # 同一案例多个 chunk 命中：保留最高分那次
            scope = _str_dict(fm.get("scope"))
            matched_on: List[str] = []
            rejected = False
            for key, value in scope_filter.items():
                if key not in scope:
                    continue  # 条目缺该键：保守放行
                if scope[key] != str(value):
                    rejected = True
                    break
                matched_on.append(key)
            if rejected:
                continue
            cases[case_id] = {
                "case_id": case_id,
                "title": str(fm.get("title") or ""),
                "summary": str(fm.get("summary") or ""),
                "scope": scope,
                "lifecycle_status": str(fm.get("lifecycle_status") or "active"),
                "matched_on": matched_on,
                "score": float(hit.score),
            }
        ordered = sorted(cases.values(), key=lambda c: c["score"], reverse=True)[:top_k]
        return {"ok": True, "cases": ordered}

    @app.get("/context/cases/get", dependencies=[Depends(require_internal_token)])
    def cases_get(case_id: str = "") -> dict[str, Any]:
        """按 case_id 取回案例条目 md 原文（SP-F1），供成员 B 注入新项目。"""
        wanted = case_id.strip()
        if not wanted:
            raise HTTPException(status_code=400, detail="case_id is required")
        for path in sorted(documents_dir.glob("*.md")):
            try:
                text = path.read_text(encoding="utf-8")
            except OSError:
                continue
            fm = _parse_frontmatter(text)
            if str(fm.get("case_id") or "").strip() == wanted:
                return {"ok": True, "case_id": wanted, "content": text}
        raise HTTPException(status_code=404, detail=f"case not found: {wanted}")

    @app.get("/context/wiki/list", dependencies=[Depends(require_internal_token)])
    def wiki_list() -> dict[str, Any]:
        """共享 wiki 页面清单（SP-F1）：storage/wiki/ 下全部 .md 的相对路径。"""
        wiki_root = storage / "wiki"
        pages = (
            sorted(str(p.relative_to(wiki_root)) for p in wiki_root.rglob("*.md"))
            if wiki_root.is_dir()
            else []
        )
        return {"ok": True, "pages": pages}

    return app
