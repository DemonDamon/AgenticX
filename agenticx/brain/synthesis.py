#!/usr/bin/env python3
"""Brain query synthesis with citations and gap analysis.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from agenticx.studio.kb.contracts import RetrievalHit, RetrievalHitSource

logger = logging.getLogger(__name__)


@dataclass
class SynthesisResult:
    ok: bool
    answer: str = ""
    gaps: str = ""
    references: List[Dict[str, Any]] = field(default_factory=list)
    hits: List[RetrievalHit] = field(default_factory=list)
    error: Optional[str] = None


def _format_hits_for_prompt(hits: List[RetrievalHit]) -> str:
    lines: List[str] = []
    for idx, hit in enumerate(hits, start=1):
        title = hit.source.title or hit.source.uri or hit.id
        lines.append(f"[{idx}] {title}\n{hit.text[:800]}")
    return "\n\n".join(lines)


def synthesize_brain_query(
    *,
    query: str,
    hits: List[RetrievalHit],
    provider_name: Optional[str] = None,
    model_name: Optional[str] = None,
) -> SynthesisResult:
    if not hits:
        return SynthesisResult(
            ok=True,
            answer="知识库中未找到与问题相关的资料。",
            gaps="当前脑内无命中；建议上传相关资料或放宽检索模式。",
            references=[],
            hits=[],
        )

    context = _format_hits_for_prompt(hits)
    system = (
        "你是 Near 知识库合成助手。基于检索片段写带 [N] 引用的中文答案，"
        "并在末尾单独输出「缺口分析」：说明资料缺失、可能过时或无法确认之处。"
    )
    user = f"问题：{query}\n\n资料：\n{context}"

    try:
        from agenticx.llms.provider_resolver import ProviderResolver

        llm = ProviderResolver.resolve(provider_name=provider_name, model_name=model_name)
        resp = llm.invoke([{"role": "system", "content": system}, {"role": "user", "content": user}])
        text = str(getattr(resp, "content", resp) or "")
    except Exception as exc:
        logger.exception("synthesis failed")
        return SynthesisResult(ok=False, error=str(exc), hits=hits)

    refs = [
        {
            "id": i + 1,
            "title": h.source.title or h.source.uri,
            "uri": h.source.uri,
            "score": h.score,
        }
        for i, h in enumerate(hits)
    ]
    gaps = ""
    if "缺口" in text:
        parts = text.split("缺口", 1)
        if len(parts) == 2:
            gaps = "缺口" + parts[1]
    return SynthesisResult(ok=True, answer=text, gaps=gaps, references=refs, hits=hits)


def hit_from_dict(data: Dict[str, Any]) -> RetrievalHit:
    src_raw = data.get("source") if isinstance(data.get("source"), dict) else {}
    source = RetrievalHitSource(
        kind=str(src_raw.get("kind") or "local"),  # type: ignore[arg-type]
        uri=str(src_raw.get("uri") or ""),
        title=src_raw.get("title"),
        chunk_index=src_raw.get("chunk_index"),
        page=src_raw.get("page"),
    )
    meta = dict(data.get("metadata") or {})
    for key in ("vector_score", "bm25_score", "fused_score", "retrieval_mode", "graph_boost"):
        if key in data and key not in meta:
            meta[key] = data[key]
    return RetrievalHit(
        id=str(data.get("id") or ""),
        score=float(data.get("score") or 0),
        text=str(data.get("text") or ""),
        source=source,
        metadata=meta,
    )


def synthesize_docs_brains(
    *,
    query: str,
    top_k: int,
    avatar_id: Optional[str] = None,
    brain_id: Optional[str] = None,
    provider_name: Optional[str] = None,
    model_name: Optional[str] = None,
) -> Dict[str, Any]:
    from agenticx.brain.manager import BrainManager
    from agenticx.brain.mount import load_avatar_brains_enabled, resolve_mounted_brain_ids
    from agenticx.brain.search import search_docs_brains
    from agenticx.brain.types import BrainType

    brains_enabled = load_avatar_brains_enabled(avatar_id)
    targets = resolve_mounted_brain_ids(
        avatar_id=avatar_id,
        brains_enabled=brains_enabled,
        explicit_brain_id=brain_id,
        brain_type=BrainType.DOCS,
    )
    if not targets:
        return {
            "ok": False,
            "error": "未挂载任何文档库。",
            "answer": "",
            "gaps": "",
            "references": [],
            "hits": [],
        }

    mgr = BrainManager.instance()
    synthesis_allowed = False
    for bid in targets:
        brain = mgr.get_brain(bid)
        if brain is None:
            continue
        from agenticx.brain.runtime_docs import DocsBrainRuntime

        rt = mgr.get_runtime(bid)
        if not isinstance(rt, DocsBrainRuntime):
            continue
        cfg = rt.read_config()
        if cfg.enabled and getattr(getattr(cfg, "synthesis", None), "enabled", False):
            synthesis_allowed = True
            break

    if not synthesis_allowed:
        return {
            "ok": False,
            "error": "知识库合成未启用。请在设置 → 知识库 → 配置中开启「合成答案」。",
            "answer": "",
            "gaps": "",
            "references": [],
            "hits": [],
        }

    search_payload = search_docs_brains(
        query=query,
        top_k=top_k,
        avatar_id=avatar_id,
        brain_id=brain_id,
        brains_enabled=brains_enabled,
    )
    hit_dicts = list(search_payload.get("hits") or [])
    hits = [hit_from_dict(h) for h in hit_dicts]
    result = synthesize_brain_query(
        query=query,
        hits=hits,
        provider_name=provider_name,
        model_name=model_name,
    )
    return {
        "ok": result.ok,
        "error": result.error,
        "answer": result.answer,
        "gaps": result.gaps,
        "references": result.references,
        "hits": hit_dicts,
        "used_top_k": len(hit_dicts),
        "source": "synthesize",
    }
