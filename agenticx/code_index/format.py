"""Format tool results for agents."""

from __future__ import annotations

import json
from typing import Any, Sequence

from agenticx.code_index.backends.base import CodeSearchHit


def format_hits_for_tool(hits: Sequence[CodeSearchHit]) -> list[dict[str, Any]]:
    """Alias for brain / tool layers that expect this name."""
    return hits_to_json(hits)


def hits_to_json(hits: Sequence[CodeSearchHit]) -> list[dict[str, Any]]:
    return [
        {
            "file_path": h.file_path,
            "start_line": h.start_line,
            "end_line": h.end_line,
            "language": h.language,
            "score": round(h.score, 6),
            "snippet": h.snippet,
            "backend": h.backend,
        }
        for h in hits
    ]


def format_search_response(
    hits: Sequence[CodeSearchHit],
    *,
    partial: bool = False,
    indexing_progress: dict[str, Any] | None = None,
) -> str:
    payload: dict[str, Any] = {"results": hits_to_json(hits)}
    if partial:
        payload["partial"] = True
    if indexing_progress:
        payload["indexing_progress"] = indexing_progress
    return json.dumps(payload, ensure_ascii=False, indent=2)
