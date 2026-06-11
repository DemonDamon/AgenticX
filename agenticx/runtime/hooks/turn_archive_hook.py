#!/usr/bin/env python3
"""Archive conversation turns into WorkspaceMemoryStore for semantic recall.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
from typing import Any

from agenticx.memory.turn_archive_config import load_turn_archive_config
from agenticx.memory.workspace_memory import WorkspaceMemoryStore
from agenticx.runtime.hooks import AgentHook

logger = logging.getLogger(__name__)

_MAX_CHUNK_TEXT_CHARS = 4000


class TurnArchiveHook(AgentHook):
    """On agent_end, archive new conversation chunks into the recall store."""

    def __init__(self, *, enabled: bool = False) -> None:
        self._enabled = enabled
        self._archived_hashes: set[str] = set()

    async def on_agent_end(self, final_text: str, session: Any) -> None:
        if not self._enabled:
            return
        try:
            cfg = load_turn_archive_config()
            chat_history = list(getattr(session, "chat_history", None) or [])
            session_id = str(getattr(session, "session_id", "") or "")
            if not session_id or len(chat_history) < 2:
                return
            avatar_id = str(getattr(session, "bound_avatar_id", "") or "")
            chunks = self._build_chunks(
                chat_history,
                min_chunk_chars=int(cfg.get("min_chunk_chars", 40)),
                max_chunks=int(cfg.get("max_chunks_per_turn", 3)),
            )
            if not chunks:
                return
            asyncio.create_task(self._archive(session_id, avatar_id, chunks))
        except Exception:
            logger.debug("TurnArchiveHook.on_agent_end failed silently", exc_info=True)

    async def on_compaction(
        self,
        compacted_count: int,
        summary: str,
        session: Any,
    ) -> None:
        if not self._enabled or compacted_count <= 0:
            return
        try:
            setattr(session, "_recall_boost_pending", True)
        except Exception:
            logger.debug("TurnArchiveHook.on_compaction failed silently", exc_info=True)

    async def _archive(
        self,
        session_id: str,
        avatar_id: str,
        chunks: list[tuple[int, str]],
    ) -> None:
        store = WorkspaceMemoryStore()

        def _write() -> None:
            for turn_index, text in chunks:
                content_hash = hashlib.sha256(f"{session_id}:{text}".encode("utf-8")).hexdigest()[:16]
                if content_hash in self._archived_hashes:
                    continue
                inserted = store.archive_turn_sync(
                    session_id=session_id,
                    text=text,
                    avatar_id=avatar_id,
                    turn_index=turn_index,
                    role="pair",
                )
                if inserted:
                    self._archived_hashes.add(content_hash)

        try:
            await asyncio.to_thread(_write)
        except Exception:
            logger.debug("TurnArchiveHook._archive failed silently", exc_info=True)

    def _build_chunks(
        self,
        chat_history: list[dict],
        *,
        min_chunk_chars: int,
        max_chunks: int,
    ) -> list[tuple[int, str]]:
        """Build user+assistant pair chunks from the tail of chat history."""
        pairs: list[tuple[int, str]] = []
        i = len(chat_history) - 1
        turn_index = max(0, len(chat_history) // 2)
        while i >= 0 and len(pairs) < max(1, max_chunks):
            msg = chat_history[i]
            if not isinstance(msg, dict) or str(msg.get("role", "")) != "assistant":
                i -= 1
                continue
            assistant_text = str(msg.get("content", "") or "").strip()
            user_text = ""
            j = i - 1
            while j >= 0:
                prev = chat_history[j]
                if isinstance(prev, dict) and str(prev.get("role", "")) == "user":
                    user_text = str(prev.get("content", "") or "").strip()
                    break
                j -= 1
            if not user_text and not assistant_text:
                i -= 1
                continue
            combined = f"[user] {user_text}\n[assistant] {assistant_text}".strip()
            if len(combined) < min_chunk_chars:
                i = j - 1 if j >= 0 else i - 1
                continue
            if len(combined) > _MAX_CHUNK_TEXT_CHARS:
                head = combined[: _MAX_CHUNK_TEXT_CHARS // 2]
                tail = combined[-(_MAX_CHUNK_TEXT_CHARS // 2) :]
                combined = f"{head}\n... truncated ...\n{tail}"
            pairs.append((turn_index, combined))
            turn_index = max(0, turn_index - 1)
            i = j - 1 if j >= 0 else i - 1
        pairs.reverse()
        return pairs
