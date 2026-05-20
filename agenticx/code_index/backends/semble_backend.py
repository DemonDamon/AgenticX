"""Semble adapter backend."""

from __future__ import annotations

import contextlib
import logging
import threading
import time
import traceback
from pathlib import Path
from typing import Callable, Optional, Sequence

from agenticx.code_index.state import IndexCancelledError

from .base import CodeIndexBackend, CodeSearchHit

logger = logging.getLogger(__name__)

_MAX_FILE_BYTES = 1_000_000
_MODE_MAP = {
    "hybrid": "hybrid",
    "semantic": "semantic",
    "bm25": "bm25",
}


def format_error_summary(exc: BaseException) -> str:
    tb = exc.__traceback__
    tail = ""
    if tb is not None:
        frames = traceback.extract_tb(tb)
        if frames:
            tail_frames = frames[-3:]
            tail = " -> ".join(
                f"{Path(fr.filename).name}:{fr.lineno} in {fr.name}" for fr in tail_frames
            )
    msg = f"{type(exc).__name__}: {exc}"
    if tail:
        return f"{msg} | {tail}"
    return msg


class SembleCodeIndexBackend:
    name = "semble"

    def __init__(
        self,
        *,
        encoder: object,
        include_text_files: bool = False,
        max_memory_bytes: int = 1024 * 1024 * 1024,
    ) -> None:
        self._encoder = encoder
        self._include_text_files = include_text_files
        self._max_memory_bytes = max_memory_bytes
        self._index = None
        self._root: Path | None = None

    def build(
        self,
        codebase_path: Path,
        *,
        on_progress: Callable[[int, int], None],
        cancel_event: Optional[object] = None,
        include_text_files: bool = False,
    ) -> None:
        from semble.chunking import chunk_source
        from semble.index.dense import embed_chunks
        from semble.index.file_walker import walk_files
        from semble.index.files import detect_language, get_extensions
        from semble.index.index import SembleIndex
        from semble.index.sparse import enrich_for_bm25
        from semble.tokens import tokenize
        from semble.index.dense import SelectableBasicBackend
        from vicinity.backends.basic import BasicArgs
        import bm25s

        path = codebase_path.resolve()
        self._root = path
        use_text = include_text_files or self._include_text_files
        extensions = get_extensions(use_text, None)
        files = list(walk_files(path, extensions))
        total = len(files)
        on_progress(0, max(total, 1))

        chunks = []
        for i, file_path in enumerate(files):
            if cancel_event is not None and getattr(cancel_event, "is_set", lambda: False)():
                raise IndexCancelledError("索引已取消")
            with contextlib.suppress(OSError):
                if file_path.stat().st_size > _MAX_FILE_BYTES:
                    on_progress(i + 1, max(total, 1))
                    continue
                source = file_path.read_text(encoding="utf-8", errors="replace")
                chunk_path = file_path.relative_to(path)
                language = detect_language(file_path)
                chunks.extend(chunk_source(source, str(chunk_path), language))
            on_progress(i + 1, max(total, 1))

        if not chunks:
            raise ValueError(f"未在 {path} 下找到可索引的代码文件")

        mem_est = sum(len(c.content) for c in chunks)
        if mem_est > self._max_memory_bytes:
            raise ValueError(
                f"索引预估内存 {mem_est // (1024 * 1024)} MB 超过上限 "
                f"{self._max_memory_bytes // (1024 * 1024)} MB，请缩小 codebase_path 或调高 max_index_memory_mb"
            )

        embeddings = embed_chunks(self._encoder, chunks)
        bm25_index = bm25s.BM25()
        bm25_index.index(
            [tokenize(enrich_for_bm25(chunk)) for chunk in chunks],
            show_progress=False,
        )
        args = BasicArgs()
        semantic_index = SelectableBasicBackend(embeddings, args)
        self._index = SembleIndex(
            self._encoder,
            bm25_index,
            semantic_index,
            chunks,
            root=path,
        )
        logger.info(
            "code_index.index.done path=%s files=%s chunks=%s",
            path,
            total,
            len(chunks),
        )

    def search(self, query: str, top_k: int, strategy: str) -> Sequence[CodeSearchHit]:
        if self._index is None:
            raise RuntimeError("索引尚未构建，请先调用 code_index_create 或 code_search 触发索引")
        mode = _MODE_MAP.get(strategy.lower(), "hybrid")
        started = time.perf_counter()
        results = self._index.search(query, top_k=top_k, mode=mode)
        elapsed = time.perf_counter() - started
        logger.info(
            "code_index.search query_len=%s top_k=%s mode=%s hits=%s seconds=%.3f",
            len(query),
            top_k,
            mode,
            len(results),
            elapsed,
        )
        hits: list[CodeSearchHit] = []
        for r in results:
            chunk = r.chunk
            snippet = chunk.content
            if len(snippet) > 800:
                snippet = snippet[:800] + "…"
            hits.append(
                CodeSearchHit(
                    file_path=chunk.file_path,
                    start_line=int(chunk.start_line),
                    end_line=int(chunk.end_line),
                    language=chunk.language,
                    score=float(r.score),
                    snippet=snippet,
                    backend="semble",
                )
            )
        return hits

    def clear(self) -> None:
        self._index = None
        self._root = None

    def find_related(self, file_path: str, line: int, top_k: int) -> Sequence[CodeSearchHit]:
        if self._index is None:
            raise RuntimeError("索引尚未构建")
        results = self._index.find_related(file_path, line, top_k=top_k)
        hits: list[CodeSearchHit] = []
        for r in results:
            chunk = r.chunk
            snippet = chunk.content
            if len(snippet) > 800:
                snippet = snippet[:800] + "…"
            hits.append(
                CodeSearchHit(
                    file_path=chunk.file_path,
                    start_line=int(chunk.start_line),
                    end_line=int(chunk.end_line),
                    language=chunk.language,
                    score=float(r.score),
                    snippet=snippet,
                    backend="semble",
                )
            )
        return hits

    @property
    def stats(self) -> dict:
        if self._index is None:
            return {}
        st = self._index.stats
        return {
            "indexed_files": st.indexed_files,
            "total_chunks": st.total_chunks,
            "languages": dict(st.languages),
        }
