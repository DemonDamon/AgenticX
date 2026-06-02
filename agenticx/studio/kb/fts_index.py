#!/usr/bin/env python3
"""SQLite FTS5 keyword index for KB chunks.

Author: Damon Li
"""

from __future__ import annotations

import re
import sqlite3
import threading
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

_FTS_SPECIAL = re.compile(r'["\'\\()]')


def _sanitize_fts_query(query: str) -> str:
    """Build a conservative FTS5 MATCH expression from free text."""
    tokens = [t for t in re.split(r"\s+", (query or "").strip()) if t]
    if not tokens:
        return ""
    parts: List[str] = []
    for tok in tokens:
        cleaned = _FTS_SPECIAL.sub(" ", tok).strip()
        if cleaned:
            parts.append(f'"{cleaned}"')
    return " OR ".join(parts) if parts else ""


class ChunkFtsIndex:
    """Persistent FTS5 index colocated with the KB document registry."""

    def __init__(self, db_path: Path) -> None:
        self._path = db_path
        self._lock = threading.RLock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(str(self._path), check_same_thread=False)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    """
                    CREATE VIRTUAL TABLE IF NOT EXISTS kb_chunks_fts USING fts5(
                        chunk_id UNINDEXED,
                        document_id UNINDEXED,
                        source_path UNINDEXED,
                        source_name UNINDEXED,
                        chunk_index UNINDEXED,
                        text
                    )
                    """
                )
                conn.commit()
            finally:
                conn.close()

    def upsert_chunks(
        self,
        *,
        document_id: str,
        rows: List[Dict[str, Any]],
    ) -> None:
        """Replace all FTS rows for ``document_id``."""
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "DELETE FROM kb_chunks_fts WHERE document_id = ?",
                    (document_id,),
                )
                conn.executemany(
                    """
                    INSERT INTO kb_chunks_fts(
                        chunk_id, document_id, source_path, source_name, chunk_index, text
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    [
                        (
                            str(r["chunk_id"]),
                            document_id,
                            str(r.get("source_path") or ""),
                            str(r.get("source_name") or ""),
                            int(r.get("chunk_index") or 0),
                            str(r.get("text") or ""),
                        )
                        for r in rows
                    ],
                )
                conn.commit()
            finally:
                conn.close()

    def delete_document(self, document_id: str) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute(
                    "DELETE FROM kb_chunks_fts WHERE document_id = ?",
                    (document_id,),
                )
                conn.commit()
            finally:
                conn.close()

    def clear(self) -> None:
        with self._lock:
            conn = self._connect()
            try:
                conn.execute("DELETE FROM kb_chunks_fts")
                conn.commit()
            finally:
                conn.close()

    def search(self, query: str, *, top_k: int) -> List[Tuple[str, float, str, Dict[str, Any]]]:
        """Return ``(chunk_id, bm25_score, text, metadata)`` hits.

        FTS5 ``bm25()`` returns negative values (lower = better match). We
        convert to a positive rank score via ``1 / (1 + abs(bm25))``.
        """
        match_expr = _sanitize_fts_query(query)
        if not match_expr:
            return []
        with self._lock:
            conn = self._connect()
            try:
                cur = conn.execute(
                    f"""
                    SELECT chunk_id, document_id, source_path, source_name,
                           chunk_index, text, bm25(kb_chunks_fts) AS rank
                    FROM kb_chunks_fts
                    WHERE kb_chunks_fts MATCH ?
                    ORDER BY rank
                    LIMIT ?
                    """,
                    (match_expr, max(1, int(top_k))),
                )
                hits: List[Tuple[str, float, str, Dict[str, Any]]] = []
                for row in cur.fetchall():
                    rank = float(row["rank"] or 0.0)
                    score = 1.0 / (1.0 + abs(rank))
                    meta = {
                        "document_id": row["document_id"],
                        "source_path": row["source_path"],
                        "source_name": row["source_name"],
                        "chunk_index": row["chunk_index"],
                    }
                    hits.append((str(row["chunk_id"]), score, str(row["text"] or ""), meta))
                return hits
            finally:
                conn.close()
