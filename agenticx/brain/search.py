"""Multi-brain search aggregation (OQ-2=B: per-brain blocks + flat hits)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from agenticx.brain.manager import BrainManager
from agenticx.brain.mount import load_avatar_brains_enabled, resolve_mounted_brain_ids
from agenticx.brain.types import BrainType
from agenticx.code_index.format import format_hits_for_tool


def search_docs_brains(
    *,
    query: str,
    top_k: int,
    avatar_id: Optional[str] = None,
    brain_id: Optional[str] = None,
    brains_enabled=None,
) -> Dict[str, Any]:
    if brains_enabled is None:
        brains_enabled = load_avatar_brains_enabled(avatar_id)
    targets = resolve_mounted_brain_ids(
        avatar_id=avatar_id,
        brains_enabled=brains_enabled,
        explicit_brain_id=brain_id,
        brain_type=BrainType.DOCS,
    )
    if not targets:
        return {
            "ok": True,
            "hits": [],
            "by_brain": [],
            "used_top_k": 0,
            "source": "local",
            "brains": [],
            "hint": "未挂载任何文档库（docs brain）。请在设置 → 知识库创建并挂载，或为分身选择知识脑。",
        }

    mgr = BrainManager.instance()
    by_brain: List[Dict[str, Any]] = []
    flat: List[Dict[str, Any]] = []

    for bid in targets:
        brain = mgr.get_brain(bid)
        if brain is None or not brain.enabled:
            continue
        rt = mgr.get_runtime(bid)
        from agenticx.brain.runtime_docs import DocsBrainRuntime

        if not isinstance(rt, DocsBrainRuntime):
            continue
        cfg = rt.read_config()
        if not cfg.enabled:
            continue
        try:
            hits = rt.search(query, top_k=top_k)
        except Exception as exc:
            by_brain.append({"brain_id": bid, "brain_name": brain.name, "error": str(exc), "hits": []})
            continue
        hit_dicts = [h.to_dict() for h in hits]
        for h in hit_dicts:
            h["brain_id"] = bid
            h["brain_name"] = brain.name
        by_brain.append({"brain_id": bid, "brain_name": brain.name, "hits": hit_dicts})
        flat.extend(hit_dicts)

    flat.sort(key=lambda x: float(x.get("score") or 0), reverse=True)
    flat = flat[:top_k]

    return {
        "ok": True,
        "hits": flat,
        "by_brain": by_brain,
        "used_top_k": len(flat),
        "source": "local",
        "brains": targets,
    }


def search_code_brains(
    *,
    query: str,
    top_k: int,
    avatar_id: Optional[str] = None,
    brain_id: Optional[str] = None,
    brains_enabled=None,
    strategy: Optional[str] = None,
) -> Dict[str, Any]:
    if brains_enabled is None:
        brains_enabled = load_avatar_brains_enabled(avatar_id)
    targets = resolve_mounted_brain_ids(
        avatar_id=avatar_id,
        brains_enabled=brains_enabled,
        explicit_brain_id=brain_id,
        brain_type=BrainType.CODE,
    )
    if not targets:
        return {
            "ok": True,
            "hits": [],
            "by_brain": [],
            "used_top_k": 0,
            "brains": [],
            "hint": "未挂载任何代码库（code brain）。请在设置 → 知识库创建代码脑并配置 codebase_path。",
        }

    mgr = BrainManager.instance()
    by_brain: List[Dict[str, Any]] = []
    flat: List[Dict[str, Any]] = []

    for bid in targets:
        brain = mgr.get_brain(bid)
        if brain is None or not brain.enabled:
            continue
        from agenticx.brain.runtime_code import CodeBrainRuntime

        rt = mgr.get_runtime(bid)
        if not isinstance(rt, CodeBrainRuntime):
            continue
        if not brain.code_config().codebase_path:
            by_brain.append(
                {
                    "brain_id": bid,
                    "brain_name": brain.name,
                    "error": "codebase_path not configured",
                    "hits": [],
                }
            )
            continue
        try:
            hits = rt.search(query, top_k=top_k)
        except Exception as exc:
            by_brain.append({"brain_id": bid, "brain_name": brain.name, "error": str(exc), "hits": []})
            continue
        formatted = format_hits_for_tool(hits)
        for h in formatted:
            h["brain_id"] = bid
            h["brain_name"] = brain.name
        by_brain.append({"brain_id": bid, "brain_name": brain.name, "hits": formatted})
        flat.extend(formatted)

    return {
        "ok": True,
        "hits": flat[:top_k],
        "by_brain": by_brain,
        "used_top_k": min(len(flat), top_k),
        "brains": targets,
    }
