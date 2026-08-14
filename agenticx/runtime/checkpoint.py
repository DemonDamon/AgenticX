#!/usr/bin/env python3
"""Agent run checkpointing for crash recovery (HA Plan B).

A checkpoint captures enough of an in-flight turn to resume it after a
process crash: which tool rounds completed, which tool calls were dispatched
but not yet answered, and the confirm-gate state. Checkpoints persist through
the session storage backend's agent-state channel (Plan A), so they are
shareable across replicas when the redis backend is configured.

Resume semantics: interrupted closer rows are synthesized first (unpaired
tool_calls become explicit 「未开始」or 「结果未知」tool results), then the
restored context is passed through ``_sanitize_context_messages`` so
provider-required pairing stays intact. A ``[系统通知]`` resume hint is fed
as the turn input (not persisted to chat_history per the established
system-trigger convention), and the round loop continues at
``checkpoint.round_idx + 1``. Pending tools are NOT re-executed: re-running
side-effecting tools after a crash could duplicate effects.

Author: Damon Li
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

from agenticx.studio.storage.backend import SyncStorageFacade
from agenticx.studio.storage.factory import get_sync_storage

logger = logging.getLogger(__name__)

RESUME_SYSTEM_HINT = (
    "[系统通知] 本会话从运行时崩溃/中断中恢复。此前已完成的工具调用轮次与结果"
    "已保留在上下文中；被中断轮次的工具调用已在上下文中标注为「未开始」或「结果未知」。"
    "对标注为结果未知的写入类操作，先核验外部状态再决定是否重做。"
    "请基于现有上下文继续未完成的任务，不要重复已完成的步骤。"
)


class AgentCheckpoint(BaseModel):
    """Serializable snapshot of an in-flight agent turn."""

    session_id: str
    turn_id: str
    round_idx: int = 0
    status: Literal["in_progress", "awaiting_confirm", "completed"] = "in_progress"
    pending_tool_calls: list[dict] = Field(default_factory=list)
    confirm_state: Optional[dict] = None
    created_at: float = 0.0
    updated_at: float = 0.0


class CheckpointStore:
    """Synchronous checkpoint persistence over the session storage facade.

    Write failures are logged and swallowed (same tolerance as the existing
    mid-turn persist path); a missing/corrupt state reads as ``None``.
    """

    def __init__(self, storage: SyncStorageFacade | None = None) -> None:
        self._storage = storage or get_sync_storage()

    @staticmethod
    def new_turn_id() -> str:
        return uuid.uuid4().hex

    def save(self, checkpoint: AgentCheckpoint) -> None:
        try:
            now = time.time()
            checkpoint.updated_at = now
            if not checkpoint.created_at:
                checkpoint.created_at = now
            self._storage.save_agent_state(
                checkpoint.session_id,
                {"checkpoint": checkpoint.model_dump()},
            )
        except Exception:
            logger.warning(
                "checkpoint save failed session=%s",
                checkpoint.session_id,
                exc_info=True,
            )

    def load(self, session_id: str) -> Optional[AgentCheckpoint]:
        try:
            state = self._storage.load_agent_state(session_id)
        except Exception:
            logger.warning("checkpoint load failed session=%s", session_id, exc_info=True)
            return None
        if not isinstance(state, dict):
            return None
        raw = state.get("checkpoint")
        if not isinstance(raw, dict):
            return None
        try:
            return AgentCheckpoint.model_validate(raw)
        except Exception:
            logger.warning("checkpoint corrupt session=%s (ignored)", session_id)
            return None

    def clear(self, session_id: str) -> None:
        """Remove the checkpoint marker while keeping the state document."""
        try:
            self._storage.save_agent_state(session_id, {})
        except Exception:
            logger.warning("checkpoint clear failed session=%s", session_id, exc_info=True)


def resume_interrupted_enabled() -> bool:
    """Resolve the resume-on-restart switch.

    Order: env ``AGX_RESUME_INTERRUPTED`` > ``runtime.resume_interrupted`` in
    config > default. Default is True in HA mode (``AGX_HA_MODE=redis`` or a
    redis storage backend), False otherwise.
    """
    env = os.environ.get("AGX_RESUME_INTERRUPTED", "").strip().lower()
    if env in ("1", "true", "yes", "on"):
        return True
    if env in ("0", "false", "no", "off"):
        return False
    try:
        from agenticx.cli.config_manager import ConfigManager

        cfg = ConfigManager.get_value("runtime.resume_interrupted")
        if isinstance(cfg, bool):
            return cfg
    except Exception:
        pass
    ha_mode = os.environ.get("AGX_HA_MODE", "").strip().lower()
    if ha_mode == "redis":
        return True
    storage_kind = os.environ.get("AGX_STORAGE_BACKEND", "").strip().lower()
    return storage_kind == "redis"
