"""Multi-brain search aggregation (OQ-2=B: per-brain blocks + flat hits)."""

from __future__ import annotations

import re
import threading
from collections import OrderedDict
from typing import Any, Dict, List, Optional

from agenticx.brain.manager import BrainManager
from agenticx.brain.mount import load_avatar_brains_enabled, resolve_mounted_brain_ids
from agenticx.brain.types import BrainType
from agenticx.code_index.format import format_hits_for_tool

# --------------------------------------------------------------------------- #
# Tiered reading (SP32, Plan-Id: sp32-kb-tiered-retrieval)                    #
#                                                                             #
# L0 (index view): knowledge_search returns a compact snippet per hit so the   #
#   model can judge relevance / build citations without burning tokens on     #
#   full parent-expanded text for every chunk.                                #
# L1 (full text on demand): knowledge_read(hit_id) fetches the full text of    #
#   a single hit from the LRU cache populated at search time.                  #
# --------------------------------------------------------------------------- #

L0_SNIPPET_LIMIT = 280
"""Characters kept per hit in compact (L0) search results."""

_FULLTEXT_CACHE_MAX = 256
"""Upper bound on cached full-text hits (LRU). One entry ≈ a parent chunk,
so this caps worst-case memory at a few hundred KB, not the whole KB."""

_CJK_RE = re.compile(r"[\u4e00-\u9fff]")


def _query_keywords(query: str) -> List[str]:
    """Split a query into anchor keywords for snippet windows.

    Whitespace tokens (length ≥ 2) come first; CJK runs get 2-gram windows so
    Chinese queries still locate the relevant span inside a chunk.
    """
    keys: List[str] = []
    for token in (query or "").split():
        cleaned = token.strip("，。？！、；：,.?!;:\"'()[]（）【】")
        if len(cleaned) < 2:
            continue
        if _CJK_RE.search(cleaned):
            cjk_chars = "".join(ch for ch in cleaned if _CJK_RE.match(ch))
            for i in range(len(cjk_chars) - 1):
                keys.append(cjk_chars[i : i + 2])
        else:
            keys.append(cleaned.lower())
    return keys


def make_query_snippet(text: str, query: str, limit: int = L0_SNIPPET_LIMIT) -> str:
    """Return a ≤ ``limit``-char excerpt of ``text`` centred on a query keyword.

    Falls back to the head of the text when no keyword matches. Whitespace is
    collapsed so the model sees a dense, quote-ready line.
    """
    cleaned = re.sub(r"\s+", " ", str(text or "")).strip()
    if len(cleaned) <= limit:
        return cleaned
    lower = cleaned.lower()
    pos = -1
    for key in _query_keywords(query):
        idx = lower.find(key.lower())
        if idx >= 0:
            pos = idx
            break
    if pos < 0:
        return cleaned[:limit]
    start = max(0, min(pos - limit // 3, len(cleaned) - limit))
    return cleaned[start : start + limit]


class _HitFulltextCache:
    """Thread-safe LRU: ``{brain_id}::{hit_id}`` → full hit dict (L1 store)."""

    def __init__(self, max_entries: int = _FULLTEXT_CACHE_MAX) -> None:
        self._max = max(1, int(max_entries))
        self._lock = threading.Lock()
        self._store: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()

    def put(self, brain_id: str, hit: Dict[str, Any]) -> None:
        key = f"{brain_id}::{hit.get('id') or ''}"
        with self._lock:
            self._store[key] = hit
            self._store.move_to_end(key)
            while len(self._store) > self._max:
                self._store.popitem(last=False)

    def get(self, hit_id: str, brain_id: Optional[str] = None) -> Optional[Dict[str, Any]]:
        hit_id = str(hit_id or "").strip()
        if not hit_id:
            return None
        with self._lock:
            if brain_id:
                hit = self._store.get(f"{brain_id}::{hit_id}")
                if hit is not None:
                    self._store.move_to_end(f"{brain_id}::{hit_id}")
                return hit
            for key, hit in reversed(self._store.items()):
                if key.endswith(f"::{hit_id}"):
                    self._store.move_to_end(key)
                    return hit
            return None

    def clear(self) -> None:
        with self._lock:
            self._store.clear()


_HIT_FULLTEXT_CACHE = _HitFulltextCache()


def read_kb_hit(hit_id: str, brain_id: Optional[str] = None) -> Dict[str, Any]:
    """L1 read: return the full-text hit cached by a previous L0 search."""
    hit = _HIT_FULLTEXT_CACHE.get(hit_id, brain_id=brain_id)
    if hit is None:
        return {
            "ok": False,
            "error": (
                f"hit {hit_id!r} not found in the full-text cache. "
                "Call knowledge_search first, then knowledge_read(hit_id) with the id "
                "from that result. Cache holds the most recent searches only (LRU)."
            ),
            "hits": [],
        }
    out = dict(hit)
    out["ok"] = True
    return out


def _compact_hit(hit: Dict[str, Any], query: str) -> Dict[str, Any]:
    """Project one full hit to its L0 form (snippet text + read hint)."""
    compact = dict(hit)
    compact["text"] = make_query_snippet(str(hit.get("text") or ""), query)
    compact["read_full_text"] = f"knowledge_read(hit_id={hit.get('id') or ''})"
    return compact


def search_docs_brains(
    *,
    query: str,
    top_k: int,
    avatar_id: Optional[str] = None,
    brain_id: Optional[str] = None,
    brains_enabled=None,
    detail: str = "full",
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

    def _is_wiki_hit(item: Dict[str, Any]) -> bool:
        if str(item.get("id") or "").startswith("wiki::"):
            return True
        meta = item.get("metadata") or {}
        return bool(isinstance(meta, dict) and meta.get("wiki_page"))

    wiki_hits = [item for item in flat if _is_wiki_hit(item)]
    chunk_hits = [item for item in flat if not _is_wiki_hit(item)]
    chunk_hits.sort(key=lambda x: float(x.get("score") or 0), reverse=True)
    wiki_hits.sort(key=lambda x: float(x.get("score") or 0), reverse=True)
    flat = chunk_hits[:top_k] + wiki_hits[:3]

    if str(detail or "full").strip().lower() == "compact":
        # L0 index view: cache full texts for knowledge_read (L1), then swap
        # each hit's text for a query-relevant snippet so the model context
        # stays small. by_brain is dropped — it repeats the same hits and the
        # compactor's projection already treats it as dead weight for the model.
        for item in flat:
            _HIT_FULLTEXT_CACHE.put(str(item.get("brain_id") or ""), dict(item))
        return {
            "ok": True,
            "hits": [_compact_hit(item, query) for item in flat],
            "used_top_k": len(flat),
            "source": "local",
            "brains": targets,
            "detail": "compact",
            "hint": (
                "结果为紧凑摘要（每条仅保留查询相关摘录）。回答需要完整段落时，"
                "对需要的条目调用 knowledge_read(hit_id=...) 获取全文；"
                "如需一次性取回全文结果，可传 detail=\"full\"。"
            ),
        }

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
