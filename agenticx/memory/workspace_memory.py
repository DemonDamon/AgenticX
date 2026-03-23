#!/usr/bin/env python3
"""Workspace markdown memory index with SQLite + FTS + semantic ranking.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Tuple

DEFAULT_WORKSPACE_MEMORY_DB = Path.home() / ".agenticx" / "memory" / "main.sqlite"


@dataclass
class MemoryChunk:
    """One indexed memory chunk."""

    chunk_id: str
    path: str
    source: str
    start_line: int
    end_line: int
    model: str
    text: str
    embedding: bytes
    created_at: str


class WorkspaceMemoryStore:
    """SQLite-backed workspace memory index and search."""

    _CHUNK_HEADING_RE = re.compile(r"^#{1,6}\s")
    _MAX_SECTION_LINES = 60
    _FALLBACK_CHUNK_LINES = 40

    def __init__(
        self,
        db_path: Path | None = None,
        *,
        embedding_provider: str = "hashing-v1",
        embedding_model: str = "hashing-64d",
    ) -> None:
        self.db_path = Path(db_path or DEFAULT_WORKSPACE_MEMORY_DB).expanduser().resolve(strict=False)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.embedding_provider = embedding_provider
        self.embedding_model = embedding_model
        self._ensure_schema()

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _ensure_schema(self) -> None:
        with self._connect() as conn:
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS files (
                    path TEXT PRIMARY KEY,
                    hash TEXT NOT NULL,
                    mtime REAL NOT NULL,
                    size INTEGER NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS chunks (
                    id TEXT PRIMARY KEY,
                    path TEXT NOT NULL,
                    source TEXT,
                    start_line INTEGER,
                    end_line INTEGER,
                    model TEXT,
                    text TEXT NOT NULL,
                    embedding BLOB,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts
                USING fts5(text, path UNINDEXED, source UNINDEXED, content='')
                """
            )
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS embedding_cache (
                    provider TEXT NOT NULL,
                    model TEXT NOT NULL,
                    hash TEXT NOT NULL,
                    embedding BLOB NOT NULL,
                    PRIMARY KEY (provider, model, hash)
                )
                """
            )
            conn.commit()

    async def index_workspace(self, workspace_dir: Path) -> Dict[str, Any]:
        return await asyncio.to_thread(self.index_workspace_sync, workspace_dir)

    def index_workspace_sync(self, workspace_dir: Path) -> Dict[str, Any]:
        workspace = Path(workspace_dir).expanduser().resolve(strict=False)
        targets = [
            workspace / "MEMORY.md",
            workspace / "IDENTITY.md",
            workspace / "USER.md",
            workspace / "SOUL.md",
        ]
        memory_dir = workspace / "memory"
        if memory_dir.exists() and memory_dir.is_dir():
            targets.extend(sorted(memory_dir.glob("*.md")))

        indexed = 0
        skipped = 0
        for file_path in targets:
            if not file_path.exists() or not file_path.is_file():
                continue
            changed, count = self._index_file_if_changed(file_path)
            if changed:
                indexed += count
            else:
                skipped += 1
        return {"indexed_chunks": indexed, "skipped_files": skipped, "total_files": len(targets)}

    async def index_file(self, file_path: Path) -> int:
        return await asyncio.to_thread(self.index_file_sync, file_path)

    def index_file_sync(self, file_path: Path) -> int:
        changed, count = self._index_file_if_changed(file_path, force=True)
        return count if changed else 0

    async def search(self, query: str, limit: int = 5, mode: str = "hybrid") -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self.search_sync, query, limit, mode)

    def search_sync(self, query: str, limit: int = 5, mode: str = "hybrid") -> List[Dict[str, Any]]:
        q = (query or "").strip()
        if not q:
            return []
        mode = (mode or "hybrid").strip().lower()
        if mode not in {"hybrid", "fts", "semantic"}:
            mode = "hybrid"
        n = max(1, int(limit))
        if mode == "fts":
            return self._search_fts(q, n)
        if mode == "semantic":
            return self._search_semantic(q, n)
        merged = self._merge_ranked(self._search_fts(q, n * 2), self._search_semantic(q, n * 2))
        return merged[:n]

    async def get_recent_memories(self, days: int = 7, limit: int = 10) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self.get_recent_memories_sync, days, limit)

    def get_recent_memories_sync(self, days: int = 7, limit: int = 10) -> List[Dict[str, Any]]:
        n = max(1, int(limit))
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, path, source, start_line, end_line, model, text, created_at
                FROM chunks
                ORDER BY created_at DESC
                LIMIT ?
                """,
                (n,),
            ).fetchall()
            return [self._row_to_result(row, score=0.0) for row in rows]

    def _index_file_if_changed(self, file_path: Path, *, force: bool = False) -> Tuple[bool, int]:
        path = str(file_path.resolve(strict=False))
        stat = file_path.stat()
        content = file_path.read_text(encoding="utf-8", errors="replace")
        content_hash = hashlib.sha256(content.encode("utf-8")).hexdigest()
        with self._connect() as conn:
            previous = conn.execute("SELECT hash FROM files WHERE path = ?", (path,)).fetchone()
            if not force and previous is not None and str(previous["hash"]) == content_hash:
                return False, 0

            conn.execute("DELETE FROM chunks_fts WHERE path = ?", (path,))
            conn.execute("DELETE FROM chunks WHERE path = ?", (path,))
            now = datetime.now(timezone.utc).isoformat()
            chunks = list(self._chunk_text(content))
            for idx, (start_line, end_line, chunk_text) in enumerate(chunks):
                chunk_hash = hashlib.sha256(f"{path}:{idx}:{chunk_text}".encode("utf-8")).hexdigest()
                embedding = self._get_cached_embedding(conn, chunk_hash, chunk_text)
                chunk_id = f"ch-{chunk_hash[:16]}"
                source = file_path.name
                conn.execute(
                    """
                    INSERT OR REPLACE INTO chunks (id, path, source, start_line, end_line, model, text, embedding, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        chunk_id,
                        path,
                        source,
                        start_line,
                        end_line,
                        self.embedding_model,
                        chunk_text,
                        embedding,
                        now,
                    ),
                )
                conn.execute(
                    "INSERT INTO chunks_fts(rowid, text, path, source) VALUES ((SELECT rowid FROM chunks WHERE id = ?), ?, ?, ?)",
                    (chunk_id, chunk_text, path, source),
                )
            conn.execute(
                """
                INSERT OR REPLACE INTO files (path, hash, mtime, size)
                VALUES (?, ?, ?, ?)
                """,
                (path, content_hash, float(stat.st_mtime), int(stat.st_size)),
            )
            conn.commit()
            return True, len(chunks)

    def _chunk_text(self, content: str) -> Iterable[Tuple[int, int, str]]:
        lines = content.splitlines()
        if not lines:
            return []
        heading_indices = [i for i, line in enumerate(lines) if self._CHUNK_HEADING_RE.match(line)]
        if not heading_indices:
            return self._chunk_fixed(lines)
        sections: List[Tuple[int, int]] = []
        if heading_indices[0] > 0:
            sections.append((0, heading_indices[0]))
        for idx, start in enumerate(heading_indices):
            end = heading_indices[idx + 1] if idx + 1 < len(heading_indices) else len(lines)
            sections.append((start, end))
        out: List[Tuple[int, int, str]] = []
        for start, end in sections:
            if end - start <= self._MAX_SECTION_LINES:
                text = "\n".join(lines[start:end]).strip()
                if text:
                    out.append((start + 1, end, text))
            else:
                out.extend(self._subsplit_section(lines, start, end))
        return out

    def _chunk_fixed(self, lines: List[str]) -> List[Tuple[int, int, str]]:
        chunk_size = self._FALLBACK_CHUNK_LINES
        out: List[Tuple[int, int, str]] = []
        for start in range(0, len(lines), chunk_size):
            end = min(len(lines), start + chunk_size)
            text = "\n".join(lines[start:end]).strip()
            if not text:
                continue
            out.append((start + 1, end, text))
        return out

    def _subsplit_section(self, lines: List[str], section_start: int, section_end: int) -> List[Tuple[int, int, str]]:
        """Split a long markdown section at blank-line boundaries when possible."""
        max_n = self._MAX_SECTION_LINES
        out: List[Tuple[int, int, str]] = []
        i = section_start
        while i < section_end:
            limit_excl = min(i + max_n, section_end)
            if limit_excl >= section_end:
                text = "\n".join(lines[i:section_end]).strip()
                if text:
                    out.append((i + 1, section_end, text))
                break
            chunk_end_excl = limit_excl
            for j in range(limit_excl - 1, i, -1):
                if not lines[j].strip():
                    chunk_end_excl = j
                    break
            if chunk_end_excl <= i:
                chunk_end_excl = min(i + max_n, section_end)
            text = "\n".join(lines[i:chunk_end_excl]).strip()
            if text:
                out.append((i + 1, chunk_end_excl, text))
            i = chunk_end_excl
            while i < section_end and not lines[i].strip():
                i += 1
        return out

    def _search_fts(self, query: str, limit: int) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT c.id, c.path, c.source, c.start_line, c.end_line, c.model, c.text, c.created_at
                FROM chunks_fts f
                JOIN chunks c ON c.rowid = f.rowid
                WHERE chunks_fts MATCH ?
                LIMIT ?
                """,
                (query, max(1, limit)),
            ).fetchall()
            return [self._row_to_result(row, score=1.0 - (idx * 0.01)) for idx, row in enumerate(rows)]

    def _search_semantic(self, query: str, limit: int) -> List[Dict[str, Any]]:
        query_vec = self._embedding_vector(query)
        scored: List[Tuple[float, sqlite3.Row]] = []
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT id, path, source, start_line, end_line, model, text, embedding, created_at
                FROM chunks
                """
            ).fetchall()
            for row in rows:
                embedding_bytes = row["embedding"]
                if not isinstance(embedding_bytes, (bytes, bytearray)):
                    continue
                vec = self._decode_vector(bytes(embedding_bytes))
                score = self._cosine_similarity(query_vec, vec)
                scored.append((score, row))
        scored.sort(key=lambda item: item[0], reverse=True)
        return [self._row_to_result(row, score=score) for score, row in scored[: max(1, limit)]]

    def _merge_ranked(self, fts: List[Dict[str, Any]], semantic: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        merged: Dict[str, Dict[str, Any]] = {}
        for idx, row in enumerate(fts):
            merged[row["id"]] = dict(row)
            merged[row["id"]]["score"] = max(float(row.get("score", 0.0)), 1.0 - idx * 0.02)
        for idx, row in enumerate(semantic):
            existing = merged.get(row["id"])
            semantic_score = float(row.get("score", 0.0))
            if existing is None:
                merged[row["id"]] = dict(row)
                continue
            existing["score"] = max(float(existing.get("score", 0.0)), semantic_score)
        result = list(merged.values())
        result.sort(key=lambda item: float(item.get("score", 0.0)), reverse=True)
        return result

    def _row_to_result(self, row: sqlite3.Row, *, score: float) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "path": str(row["path"]),
            "source": str(row["source"] or ""),
            "start_line": int(row["start_line"] or 0),
            "end_line": int(row["end_line"] or 0),
            "model": str(row["model"] or ""),
            "text": str(row["text"]),
            "created_at": str(row["created_at"]),
            "score": round(float(score), 4),
        }

    def _get_cached_embedding(self, conn: sqlite3.Connection, text_hash: str, text: str) -> bytes:
        cached = conn.execute(
            """
            SELECT embedding FROM embedding_cache
            WHERE provider = ? AND model = ? AND hash = ?
            """,
            (self.embedding_provider, self.embedding_model, text_hash),
        ).fetchone()
        if cached is not None and isinstance(cached["embedding"], (bytes, bytearray)):
            return bytes(cached["embedding"])
        vector = self._embedding_vector(text)
        encoded = self._encode_vector(vector)
        conn.execute(
            """
            INSERT OR REPLACE INTO embedding_cache (provider, model, hash, embedding)
            VALUES (?, ?, ?, ?)
            """,
            (self.embedding_provider, self.embedding_model, text_hash, encoded),
        )
        return encoded

    def _embedding_vector(self, text: str) -> List[float]:
        # Lightweight deterministic embedding for local semantic ranking without external API.
        dim = 64
        vec = [0.0] * dim
        tokens = [token.strip().lower() for token in text.split() if token.strip()]
        if not tokens:
            return vec
        for token in tokens:
            digest = hashlib.sha256(token.encode("utf-8")).digest()
            idx = digest[0] % dim
            sign = 1.0 if (digest[1] % 2 == 0) else -1.0
            vec[idx] += sign
        norm = math.sqrt(sum(v * v for v in vec))
        if norm <= 0:
            return vec
        return [v / norm for v in vec]

    def _encode_vector(self, vector: List[float]) -> bytes:
        return json.dumps(vector, ensure_ascii=False).encode("utf-8")

    def _decode_vector(self, blob: bytes) -> List[float]:
        try:
            data = json.loads(blob.decode("utf-8"))
            if isinstance(data, list):
                return [float(v) for v in data]
        except Exception:
            pass
        return []

    def _cosine_similarity(self, left: List[float], right: List[float]) -> float:
        if not left or not right or len(left) != len(right):
            return 0.0
        dot = sum(a * b for a, b in zip(left, right))
        left_norm = math.sqrt(sum(v * v for v in left))
        right_norm = math.sqrt(sum(v * v for v in right))
        if left_norm == 0 or right_norm == 0:
            return 0.0
        return dot / (left_norm * right_norm)
