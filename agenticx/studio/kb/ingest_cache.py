#!/usr/bin/env python3
"""Incremental ingest cache for KB documents.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from .contracts import ChunkingSpec, KBConfig


def compute_source_content_hash(source_path: str) -> str:
    path = Path(source_path).expanduser()
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for block in iter(lambda: fh.read(65536), b""):
            h.update(block)
    return h.hexdigest()


def chunking_fingerprint(spec: ChunkingSpec) -> str:
    return f"{spec.strategy}:{spec.chunk_size}:{spec.chunk_overlap}"


def ingest_cache_key(
    *,
    source_hash: str,
    chunking_fp: str,
    embedding_fp: str,
) -> str:
    return f"{source_hash}|{chunking_fp}|{embedding_fp}"


class IngestCacheStore:
    """Maps document_id → last successful ingest fingerprint."""

    def __init__(self, cache_path: Path) -> None:
        self._path = cache_path
        self._lock = threading.RLock()
        self._data: Dict[str, Any] = {}
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            self._data = {"entries": {}}
            return
        try:
            raw = json.loads(self._path.read_text(encoding="utf-8"))
            if isinstance(raw, dict) and isinstance(raw.get("entries"), dict):
                self._data = raw
            else:
                self._data = {"entries": {}}
        except Exception:
            self._data = {"entries": {}}

    def _save(self) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._path.write_text(json.dumps(self._data, ensure_ascii=False, indent=2), encoding="utf-8")

    def get(self, document_id: str) -> Optional[Dict[str, Any]]:
        entries = self._data.get("entries") or {}
        row = entries.get(document_id)
        return dict(row) if isinstance(row, dict) else None

    def put(
        self,
        document_id: str,
        *,
        source_hash: str,
        chunking_fp: str,
        embedding_fp: str,
        chunks: int,
    ) -> None:
        key = ingest_cache_key(
            source_hash=source_hash,
            chunking_fp=chunking_fp,
            embedding_fp=embedding_fp,
        )
        with self._lock:
            entries = self._data.setdefault("entries", {})
            entries[document_id] = {
                "cache_key": key,
                "source_hash": source_hash,
                "chunking_fp": chunking_fp,
                "embedding_fp": embedding_fp,
                "chunks": int(chunks),
            }
            self._save()

    def is_hit(self, document_id: str, config: KBConfig, source_path: str) -> bool:
        row = self.get(document_id)
        if not row:
            return False
        try:
            current_hash = compute_source_content_hash(source_path)
        except OSError:
            return False
        current_key = ingest_cache_key(
            source_hash=current_hash,
            chunking_fp=chunking_fingerprint(config.chunking),
            embedding_fp=config.embedding_fingerprint(),
        )
        return str(row.get("cache_key") or "") == current_key

    def remove(self, document_id: str) -> None:
        with self._lock:
            entries = self._data.get("entries") or {}
            if document_id in entries:
                del entries[document_id]
                self._save()

    def clear(self) -> None:
        with self._lock:
            self._data = {"entries": {}}
            self._save()
