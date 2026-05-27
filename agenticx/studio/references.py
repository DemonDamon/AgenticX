#!/usr/bin/env python3
"""Search reference payloads for web_search / knowledge_search tool results.

Author: Damon Li
"""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional
from urllib.parse import urlparse


def extract_domain(url: str) -> str:
    try:
        return (urlparse(str(url or "")).netloc or "").strip()
    except Exception:
        return ""


def snippet_trim(text: str, limit: int = 200) -> str:
    compact = " ".join(str(text or "").split())
    if len(compact) <= limit:
        return compact
    return f"{compact[:limit]}…"


def reset_turn_references(session: Any) -> None:
    session._reference_id_counter = 0
    session._turn_references = []
    session._turn_searched_queries = []
    session._web_search_pending = []


def _assign_reference_ids(session: Any, references: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    counter = int(getattr(session, "_reference_id_counter", 0) or 0)
    assigned: List[Dict[str, Any]] = []
    for ref in references:
        counter += 1
        assigned.append({**ref, "id": counter})
    session._reference_id_counter = counter
    return assigned


def append_turn_references(
    session: Any,
    references: List[Dict[str, Any]],
    queries: Optional[List[str]] = None,
) -> List[Dict[str, Any]]:
    if not isinstance(getattr(session, "_turn_references", None), list):
        session._turn_references = []
    if not isinstance(getattr(session, "_turn_searched_queries", None), list):
        session._turn_searched_queries = []
    assigned = _assign_reference_ids(session, references)
    session._turn_references.extend(assigned)
    if queries:
        seen = set(session._turn_searched_queries)
        for raw in queries:
            q = str(raw or "").strip()
            if q and q not in seen:
                session._turn_searched_queries.append(q)
                seen.add(q)
    return assigned


def build_web_references(hits: Any, provider: str) -> List[Dict[str, Any]]:
    refs: List[Dict[str, Any]] = []
    for hit in hits or []:
        title = str(getattr(hit, "title", "") or "").strip()
        url = str(getattr(hit, "url", "") or "").strip()
        snippet = snippet_trim(getattr(hit, "snippet", "") or "")
        if not title and not url:
            continue
        refs.append(
            {
                "title": title or url,
                "url": url,
                "snippet": snippet,
                "source": "web",
                "provider": str(provider or "duckduckgo").strip() or "duckduckgo",
                "domain": extract_domain(url),
            }
        )
    return refs


def build_kb_references(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    refs: List[Dict[str, Any]] = []
    for hit in payload.get("hits") or []:
        if not isinstance(hit, dict):
            continue
        source = hit.get("source") if isinstance(hit.get("source"), dict) else {}
        doc_id = str(source.get("uri") or hit.get("id") or "").strip()
        chunk_idx = source.get("chunk_index")
        title = str(source.get("title") or doc_id or "KB").strip() or "KB"
        chunk_label = f"#{chunk_idx}" if chunk_idx is not None else ""
        url = f"agx://kb/{doc_id}{chunk_label}" if doc_id else "agx://kb/unknown"
        refs.append(
            {
                "title": title,
                "url": url,
                "snippet": snippet_trim(str(hit.get("text") or "")),
                "source": "kb",
            }
        )
    return refs


def queue_web_search_batch(session: Any, *, query: str, hits: Any, provider: str) -> None:
    pending = getattr(session, "_web_search_pending", None)
    if not isinstance(pending, list):
        pending = []
        session._web_search_pending = pending
    pending.append({"query": str(query or "").strip(), "hits": hits, "provider": provider})


def turn_reference_payload(session: Any) -> Dict[str, Any]:
    refs = getattr(session, "_turn_references", None)
    queries = getattr(session, "_turn_searched_queries", None)
    payload: Dict[str, Any] = {}
    if isinstance(refs, list) and refs:
        payload["references"] = list(refs)
    if isinstance(queries, list) and queries:
        payload["searched_queries"] = list(queries)
    return payload


def structured_payload_for_tool_result(
    session: Any,
    tool_name: str,
    arguments: Dict[str, Any],
    result: Any,
) -> Optional[Dict[str, Any]]:
    try:
        if tool_name == "web_search":
            pending = getattr(session, "_web_search_pending", None)
            if not isinstance(pending, list) or not pending:
                return None
            batch = pending.pop(0)
            hits = batch.get("hits") or []
            provider = str(batch.get("provider") or "duckduckgo")
            query = str(batch.get("query") or arguments.get("query") or "").strip()
            refs = build_web_references(hits, provider)
            if not refs:
                return {"references": [], "query": query} if query else None
            assigned = append_turn_references(session, refs, [query] if query else None)
            return {"references": assigned, "query": query}

        if tool_name == "knowledge_search":
            parsed: Dict[str, Any]
            if isinstance(result, dict):
                parsed = result
            else:
                parsed = json.loads(str(result or "{}"))
            if not isinstance(parsed, dict) or parsed.get("ok") is False:
                return None
            if parsed.get("disabled"):
                return None
            query = str(arguments.get("query") or "").strip()
            refs = build_kb_references(parsed)
            if not refs:
                return {"references": [], "query": query} if query else None
            assigned = append_turn_references(session, refs, [query] if query else None)
            return {"references": assigned, "query": query}
    except Exception:
        return None
    return None
