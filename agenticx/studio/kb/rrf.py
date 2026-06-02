#!/usr/bin/env python3
"""Reciprocal Rank Fusion for KB hybrid retrieval.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Tuple

DEFAULT_RRF_K = 60


def reciprocal_rank_fusion(
    ranked_lists: List[List[Tuple[str, float, str, Dict[str, Any]]]],
    *,
    k: int = DEFAULT_RRF_K,
    weights: Optional[List[float]] = None,
) -> List[Tuple[str, float, str, Dict[str, Any], Dict[str, float]]]:
    """Fuse multiple ranked lists with weighted RRF.

    Each input item is ``(chunk_id, channel_score, text, metadata)``.
    Returns fused rows as ``(chunk_id, fused_score, text, metadata, score_parts)``
    where ``score_parts`` contains ``vector_score``, ``bm25_score``, ``fused_score``.
    """
    if not ranked_lists:
        return []
    w = weights or [1.0] * len(ranked_lists)
    if len(w) != len(ranked_lists):
        w = [1.0] * len(ranked_lists)

    acc: Dict[str, Dict[str, Any]] = {}
    for list_idx, ranked in enumerate(ranked_lists):
        weight = float(w[list_idx])
        channel = "vector_score" if list_idx == 0 else "bm25_score"
        for rank, (cid, score, text, meta) in enumerate(ranked):
            entry = acc.get(cid)
            if entry is None:
                entry = {
                    "text": text,
                    "metadata": dict(meta),
                    "vector_score": 0.0,
                    "bm25_score": 0.0,
                    "fused_score": 0.0,
                }
                acc[cid] = entry
            entry[channel] = max(float(entry[channel]), float(score))
            entry["fused_score"] += weight / (float(k) + float(rank) + 1.0)
            if text:
                entry["text"] = text
            if meta:
                entry["metadata"].update(meta)

    fused: List[Tuple[str, float, str, Dict[str, Any], Dict[str, float]]] = []
    for cid, entry in acc.items():
        parts = {
            "vector_score": float(entry["vector_score"]),
            "bm25_score": float(entry["bm25_score"]),
            "fused_score": float(entry["fused_score"]),
        }
        fused.append((cid, parts["fused_score"], str(entry["text"]), dict(entry["metadata"]), parts))
    fused.sort(key=lambda x: x[1], reverse=True)
    return fused
