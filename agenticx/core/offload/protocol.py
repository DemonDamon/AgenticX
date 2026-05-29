#!/usr/bin/env python3
"""Offloader protocol and reference handle.

The offload abstraction lets the runtime keep large tool results and compressed
context out of the live conversation history. Instead of inlining a multi-KB
blob, the caller offloads the payload and keeps only a small ``Reference``
placeholder; the full content is retrieved on demand by handle.

Mechanism mirrors AgentScope 2.0's ``Offloader`` protocol
(``workspace/_offload_protocol.py``), but the return type is a structured
``Reference`` rather than a bare string so AGX can carry size / summary /
content-type metadata and render an inline placeholder for chat history.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import time
from dataclasses import dataclass, field
from typing import Any, Dict, List, Protocol, Sequence, runtime_checkable

DEFAULT_OFFLOAD_THRESHOLD_BYTES = 4096

REFERENCE_PLACEHOLDER_PREFIX = "@offload-ref"


class OffloadError(Exception):
    """Raised when an offload write or retrieve operation fails."""


@dataclass
class Reference:
    """A lightweight handle to offloaded content.

    Attributes:
        handle: Stable content identifier (sha256 hex of the payload).
        size: Byte length of the original payload.
        kind: Either ``"context"`` or ``"tool_result"``.
        session_id: Owning session id.
        summary: Short human-readable summary kept inline for the agent.
        content_type: MIME-ish type hint, defaults to ``text/plain``.
        tool_name: Originating tool name when ``kind == "tool_result"``.
        created_at: Unix timestamp of creation.
    """

    handle: str
    size: int
    kind: str
    session_id: str
    summary: str = ""
    content_type: str = "text/plain"
    tool_name: str = ""
    created_at: float = field(default_factory=time.time)

    def to_placeholder(self) -> str:
        """Render an inline placeholder safe to store in chat history.

        The placeholder is compact and self-describing so the agent can decide
        whether to retrieve the full payload.
        """
        label = self.tool_name or self.kind
        summary = self.summary.strip().replace("\n", " ")
        if len(summary) > 200:
            summary = summary[:200] + "..."
        suffix = f" summary={summary!r}" if summary else ""
        return (
            f"{REFERENCE_PLACEHOLDER_PREFIX}:{self.handle} "
            f"kind={self.kind} label={label} bytes={self.size}{suffix}"
        )

    def to_dict(self) -> Dict[str, Any]:
        """Serialize to a plain dict (json-safe)."""
        return {
            "handle": self.handle,
            "size": self.size,
            "kind": self.kind,
            "session_id": self.session_id,
            "summary": self.summary,
            "content_type": self.content_type,
            "tool_name": self.tool_name,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> "Reference":
        """Rebuild a Reference from a dict produced by ``to_dict``."""
        return cls(
            handle=str(data["handle"]),
            size=int(data.get("size", 0)),
            kind=str(data.get("kind", "tool_result")),
            session_id=str(data.get("session_id", "")),
            summary=str(data.get("summary", "")),
            content_type=str(data.get("content_type", "text/plain")),
            tool_name=str(data.get("tool_name", "")),
            created_at=float(data.get("created_at", time.time())),
        )


@runtime_checkable
class Offloader(Protocol):
    """Protocol for offloading and retrieving large payloads.

    Implementations must be safe to call without an active offload target
    (callers should only invoke them when offloading is enabled).
    """

    async def offload_context(
        self,
        session_id: str,
        msgs: Sequence[Dict[str, Any]],
    ) -> Reference:
        """Offload a compressed context block and return its reference."""
        ...

    async def offload_tool_result(
        self,
        session_id: str,
        tool_result: Any,
        *,
        tool_name: str = "",
    ) -> Reference:
        """Offload a single tool result and return its reference."""
        ...

    async def retrieve(self, reference: Reference) -> str:
        """Retrieve the full payload behind a reference.

        Raises:
            OffloadError: If the reference cannot be resolved.
        """
        ...


def compute_handle(payload: str) -> str:
    """Compute the stable content handle (sha256 hex) for a payload."""
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def should_offload(
    text: str,
    threshold: int = DEFAULT_OFFLOAD_THRESHOLD_BYTES,
) -> bool:
    """Decide whether ``text`` is large enough to warrant offloading.

    Args:
        text: Candidate payload.
        threshold: Byte threshold; payloads at or below it stay inline so
            behaviour is unchanged for small results.

    Returns:
        ``True`` when the UTF-8 byte length strictly exceeds ``threshold``.
    """
    if not text:
        return False
    return len(text.encode("utf-8")) > max(0, threshold)


def stringify_messages(msgs: Sequence[Dict[str, Any]]) -> str:
    """Flatten a list of chat messages into a single text blob.

    Used by context offloaders to produce a retrievable payload.
    """
    lines: List[str] = []
    for msg in msgs:
        if not isinstance(msg, dict):
            continue
        role = str(msg.get("role", "unknown"))
        content = msg.get("content", "")
        if isinstance(content, list):
            parts: List[str] = []
            for block in content:
                if isinstance(block, dict) and block.get("type") == "text":
                    parts.append(str(block.get("text", "")))
            content = "\n".join(parts)
        lines.append(f"[{role}] {content}".strip())
    return "\n".join(lines)


def stringify_tool_result(tool_result: Any) -> str:
    """Coerce an arbitrary tool result into a text payload."""
    if isinstance(tool_result, str):
        return tool_result
    if isinstance(tool_result, dict):
        content = tool_result.get("content")
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts: List[str] = []
            for block in content:
                if isinstance(block, dict) and "text" in block:
                    parts.append(str(block.get("text", "")))
                else:
                    parts.append(str(block))
            return "\n".join(parts)
    import json

    try:
        return json.dumps(tool_result, ensure_ascii=False)
    except Exception:
        return str(tool_result)
