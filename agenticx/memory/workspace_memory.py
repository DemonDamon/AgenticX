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

_TURN_RECALL_HALFLIFE_DAYS = 7.0
_CHUNK_RECALL_HALFLIFE_DAYS = 7.0

_CJK_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]")
_CJK_SEQ_RE = re.compile(r"[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]{2,8}")


def _chunk_rerank_enabled() -> bool:
    try:
        from agenticx.memory.turn_archive_config import load_chunk_rerank_config

        return bool(load_chunk_rerank_config().get("enabled", False))
    except Exception:
        return False


def extract_search_terms(query: str) -> List[str]:
    """Extract English and CJK search terms from a query string."""
    q = (query or "").strip()
    if not q:
        return []
    terms: List[str] = []
    seen: set[str] = set()
    for token in q.split():
        t = token.strip().lower()
        if len(t) >= 2 and re.search(r"[a-z0-9]", t, re.I):
            if t not in seen:
                seen.add(t)
                terms.append(t)
    for match in _CJK_SEQ_RE.finditer(q):
        seq = match.group(0)
        if seq not in seen:
            seen.add(seq)
            terms.append(seq)
    if len(q) <= 4 and _CJK_RE.search(q):
        for ch in q:
            if _CJK_RE.match(ch) and ch not in seen:
                seen.add(ch)
                terms.append(ch)
    terms.sort(key=len, reverse=True)
    return terms


def _like_escape(term: str) -> str:
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


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
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS turns (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    avatar_id TEXT,
                    turn_index INTEGER,
                    role TEXT,
                    text TEXT NOT NULL,
                    embedding BLOB,
                    content_hash TEXT NOT NULL,
                    access_count INTEGER DEFAULT 0,
                    last_accessed TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id)"
            )
            conn.execute(
                "CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_hash ON turns(content_hash)"
            )
            conn.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS turns_fts
                USING fts5(text, session_id UNINDEXED, content='')
                """
            )
            # GAP-B: chunks composite rerank columns (idempotent migration for legacy DBs)
            cols = {r["name"] for r in conn.execute("PRAGMA table_info(chunks)").fetchall()}
            if "access_count" not in cols:
                conn.execute("ALTER TABLE chunks ADD COLUMN access_count INTEGER DEFAULT 0")
            if "last_accessed" not in cols:
                conn.execute("ALTER TABLE chunks ADD COLUMN last_accessed TEXT")
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
        rerank = _chunk_rerank_enabled()
        if mode == "fts":
            res = self._search_fts(q, n)
            return self._rerank_chunks_composite(res)[:n] if rerank else res
        if mode == "semantic":
            res = self._search_semantic(q, n)
            return self._rerank_chunks_composite(res)[:n] if rerank else res
        fts = self._search_fts(q, n * 2)
        sem = self._search_semantic(q, n * 2)
        terms = extract_search_terms(q)
        sub: List[Dict[str, Any]] = []
        if self._should_use_substring(terms, fts):
            sub = self._search_substring(terms, n * 2)
        merged = self._merge_ranked(fts, sem, sub) if sub else self._merge_ranked(fts, sem)
        if rerank:
            merged = self._rerank_chunks_composite(merged)
        return merged[:n]

    async def get_recent_memories(self, days: int = 7, limit: int = 10) -> List[Dict[str, Any]]:
        return await asyncio.to_thread(self.get_recent_memories_sync, days, limit)

    def archive_turn_sync(
        self,
        *,
        session_id: str,
        text: str,
        avatar_id: str = "",
        turn_index: int = 0,
        role: str = "pair",
    ) -> bool:
        """Archive one conversation turn chunk. Returns False if duplicate."""
        body = (text or "").strip()
        sid = (session_id or "").strip()
        if not body or not sid:
            return False
        content_hash = hashlib.sha256(f"{sid}:{body}".encode("utf-8")).hexdigest()[:16]
        turn_id = f"turn-{content_hash}"
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            existing = conn.execute(
                "SELECT id FROM turns WHERE content_hash = ?",
                (content_hash,),
            ).fetchone()
            if existing is not None:
                return False
            embedding = self._get_cached_embedding(conn, content_hash, body)
            conn.execute(
                """
                INSERT INTO turns (
                    id, session_id, avatar_id, turn_index, role, text,
                    embedding, content_hash, access_count, last_accessed, created_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, ?)
                """,
                (
                    turn_id,
                    sid,
                    avatar_id or "",
                    int(turn_index),
                    role,
                    body,
                    embedding,
                    content_hash,
                    now,
                ),
            )
            conn.execute(
                """
                INSERT INTO turns_fts(rowid, text, session_id)
                VALUES ((SELECT rowid FROM turns WHERE id = ?), ?, ?)
                """,
                (turn_id, body, sid),
            )
            conn.commit()
        return True

    def search_turns_sync(
        self,
        query: str,
        limit: int = 5,
        *,
        session_id: str = "",
        halflife_days: float = _TURN_RECALL_HALFLIFE_DAYS,
    ) -> List[Dict[str, Any]]:
        """Search archived turns with recency * frequency composite rerank."""
        q = (query or "").strip()
        if not q:
            return []
        n = max(1, int(limit))
        fts = self._search_turns_fts(q, n * 2, session_id=session_id)
        sem = self._search_turns_semantic(q, n * 2, session_id=session_id)
        merged = self._merge_ranked(fts, sem)
        reranked = self._rerank_turns_composite(merged, halflife_days=halflife_days)
        return reranked[:n]

    def reinforce_turns_sync(self, turn_ids: List[str]) -> None:
        """Bump access_count and last_accessed for recalled turn rows."""
        ids = [str(tid).strip() for tid in turn_ids if str(tid).strip()]
        if not ids:
            return
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            for turn_id in ids:
                conn.execute(
                    """
                    UPDATE turns
                    SET access_count = access_count + 1, last_accessed = ?
                    WHERE id = ?
                    """,
                    (now, turn_id),
                )
            conn.commit()

    def reinforce_chunks_sync(self, chunk_ids: List[str]) -> None:
        """Bump access_count and last_accessed for recalled chunk rows."""
        ids = [str(cid).strip() for cid in chunk_ids if str(cid).strip()]
        if not ids:
            return
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as conn:
            for chunk_id in ids:
                conn.execute(
                    """
                    UPDATE chunks
                    SET access_count = access_count + 1, last_accessed = ?
                    WHERE id = ?
                    """,
                    (now, chunk_id),
                )
            conn.commit()

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

    def _should_use_substring(self, terms: List[str], fts: List[Dict[str, Any]]) -> bool:
        if not terms:
            return False
        if not fts:
            return True
        return any(_CJK_RE.search(t) for t in terms)

    def _search_substring(self, terms: List[str], limit: int) -> List[Dict[str, Any]]:
        if not terms:
            return []
        scored: Dict[str, Tuple[float, sqlite3.Row]] = {}
        cap = max(limit * 3, 20)
        with self._connect() as conn:
            for term in terms:
                pattern = f"%{_like_escape(term)}%"
                weight = min(1.0, 0.5 + len(term) * 0.08)
                rows = conn.execute(
                    """
                    SELECT id, path, source, start_line, end_line, model, text, created_at
                    FROM chunks
                    WHERE text LIKE ? ESCAPE '\\'
                    LIMIT ?
                    """,
                    (pattern, cap),
                ).fetchall()
                for row in rows:
                    chunk_id = str(row["id"])
                    prev = scored.get(chunk_id)
                    add = weight if prev is None else prev[0] + weight * 0.5
                    scored[chunk_id] = (add, row)
        ranked = sorted(scored.values(), key=lambda item: item[0], reverse=True)[: max(1, limit)]
        return [self._row_to_result(row, score=score) for score, row in ranked]

    def _search_fts(self, query: str, limit: int) -> List[Dict[str, Any]]:
        with self._connect() as conn:
            rows = conn.execute(
                """
                SELECT c.id, c.path, c.source, c.start_line, c.end_line, c.model, c.text, c.created_at, c.access_count
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
                SELECT id, path, source, start_line, end_line, model, text, embedding, created_at, access_count
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

    def _merge_ranked(self, *ranked_lists: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        merged: Dict[str, Dict[str, Any]] = {}
        for ranked in ranked_lists:
            for idx, row in enumerate(ranked):
                chunk_id = row["id"]
                rank_score = max(float(row.get("score", 0.0)), 1.0 - idx * 0.02)
                existing = merged.get(chunk_id)
                if existing is None:
                    merged[chunk_id] = dict(row)
                    merged[chunk_id]["score"] = rank_score
                    continue
                existing["score"] = max(float(existing.get("score", 0.0)), rank_score)
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
            "access_count": int(row["access_count"] or 0) if "access_count" in row.keys() else 0,
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
        for term in extract_search_terms(text):
            if _CJK_RE.search(term) and term not in tokens:
                tokens.append(term)
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

    def _search_turns_fts(
        self,
        query: str,
        limit: int,
        *,
        session_id: str = "",
    ) -> List[Dict[str, Any]]:
        sid = (session_id or "").strip()
        with self._connect() as conn:
            if sid:
                rows = conn.execute(
                    """
                    SELECT t.id, t.session_id, t.text, t.created_at, t.access_count
                    FROM turns_fts f
                    JOIN turns t ON t.rowid = f.rowid
                    WHERE turns_fts MATCH ? AND t.session_id = ?
                    LIMIT ?
                    """,
                    (query, sid, max(1, limit)),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT t.id, t.session_id, t.text, t.created_at, t.access_count
                    FROM turns_fts f
                    JOIN turns t ON t.rowid = f.rowid
                    WHERE turns_fts MATCH ?
                    LIMIT ?
                    """,
                    (query, max(1, limit)),
                ).fetchall()
            return [
                self._turn_row_to_result(row, score=1.0 - (idx * 0.01))
                for idx, row in enumerate(rows)
            ]

    def _search_turns_semantic(
        self,
        query: str,
        limit: int,
        *,
        session_id: str = "",
    ) -> List[Dict[str, Any]]:
        sid = (session_id or "").strip()
        query_vec = self._embedding_vector(query)
        scored: List[Tuple[float, sqlite3.Row]] = []
        with self._connect() as conn:
            if sid:
                rows = conn.execute(
                    """
                    SELECT id, session_id, text, embedding, created_at, access_count
                    FROM turns
                    WHERE session_id = ?
                    """,
                    (sid,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT id, session_id, text, embedding, created_at, access_count
                    FROM turns
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
        return [
            self._turn_row_to_result(row, score=score)
            for score, row in scored[: max(1, limit)]
        ]

    def _turn_row_to_result(self, row: sqlite3.Row, *, score: float) -> Dict[str, Any]:
        return {
            "id": str(row["id"]),
            "path": "",
            "source": "turn",
            "session_id": str(row["session_id"] or ""),
            "start_line": 0,
            "end_line": 0,
            "model": "",
            "text": str(row["text"]),
            "created_at": str(row["created_at"]),
            "access_count": int(row["access_count"] or 0),
            "score": round(float(score), 4),
        }

    def _rerank_chunks_composite(
        self,
        rows: List[Dict[str, Any]],
        *,
        halflife_days: float = _CHUNK_RECALL_HALFLIFE_DAYS,
    ) -> List[Dict[str, Any]]:
        """recency*frequency composite rerank for markdown chunks (mirror of turns)."""
        now = datetime.now(timezone.utc)
        halflife = max(0.1, float(halflife_days))
        enriched: List[Dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            base = max(float(item.get("score", 0.0)), 0.01)
            created_raw = str(item.get("created_at", "") or "")
            try:
                created = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
            except ValueError:
                created = now
            age_days = max(0.0, (now - created).total_seconds() / 86400.0)
            recency = math.exp(-0.693 * age_days / halflife)
            access_count = int(item.get("access_count", 0) or 0)
            frequency = math.log2(access_count + 1) + 1
            item["score"] = round(base * recency * frequency, 4)
            enriched.append(item)
        enriched.sort(key=lambda item: float(item.get("score", 0.0)), reverse=True)
        return enriched

    def _rerank_turns_composite(
        self,
        rows: List[Dict[str, Any]],
        *,
        halflife_days: float = _TURN_RECALL_HALFLIFE_DAYS,
    ) -> List[Dict[str, Any]]:
        now = datetime.now(timezone.utc)
        halflife = max(0.1, float(halflife_days))
        enriched: List[Dict[str, Any]] = []
        for row in rows:
            item = dict(row)
            base = max(float(item.get("score", 0.0)), 0.01)
            created_raw = str(item.get("created_at", "") or "")
            try:
                created = datetime.fromisoformat(created_raw.replace("Z", "+00:00"))
                if created.tzinfo is None:
                    created = created.replace(tzinfo=timezone.utc)
            except ValueError:
                created = now
            age_days = max(0.0, (now - created).total_seconds() / 86400.0)
            recency = math.exp(-0.693 * age_days / halflife)
            access_count = int(item.get("access_count", 0) or 0)
            frequency = math.log2(access_count + 1) + 1
            item["score"] = round(base * recency * frequency, 4)
            enriched.append(item)
        enriched.sort(key=lambda item: float(item.get("score", 0.0)), reverse=True)
        return enriched
