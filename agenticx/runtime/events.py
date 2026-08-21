#!/usr/bin/env python3
"""Runtime event protocol for AgentRuntime.

Author: Damon Li
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from enum import Enum
from collections.abc import Iterator
from typing import Any, Dict, List, Optional


def normalize_tool_sse_payload(data: Dict[str, Any]) -> Dict[str, Any]:
    """Ensure tool_* SSE payloads expose both ``tool_call_id`` and ``id`` when either is set.

    Desktop and adapters may read either key; mirror both for backward compatibility (P1-T1).
    """
    out = dict(data)
    tid = str(out.get("tool_call_id") or out.get("id") or "").strip()
    if tid:
        out["tool_call_id"] = tid
        out["id"] = tid
    return out


class EventType(str, Enum):
    """Event types emitted by AgentRuntime."""

    ROUND_START = "round_start"
    TOOL_CALL = "tool_call"
    TOOL_CALL_DELTA = "tool_call_delta"
    TOOL_PROGRESS = "tool_progress"
    TOOL_RESULT = "tool_result"
    CONFIRM_REQUIRED = "confirm_required"
    CONFIRM_RESPONSE = "confirm_response"
    CLARIFICATION_REQUIRED = "clarification_required"
    CLARIFICATION_RESPONSE = "clarification_response"
    CLARIFICATION_SUSPENDED = "clarification_suspended"
    TOKEN = "token"
    CONTENT_BLOCK = "content_block"
    FINAL = "final"
    ERROR = "error"
    SUBAGENT_STARTED = "subagent_started"
    SUBAGENT_PROGRESS = "subagent_progress"
    SUBAGENT_CHECKPOINT = "subagent_checkpoint"
    SUBAGENT_PAUSED = "subagent_paused"
    SUBAGENT_COMPLETED = "subagent_completed"
    SUBAGENT_ERROR = "subagent_error"
    COMPACTION = "compaction"
    CONTEXT_STATS = "context_stats"
    ROUND_END = "round_end"
    STALL = "stall"


@dataclass
class RuntimeEvent:
    """One runtime event with typed name + payload."""

    type: str
    data: Dict[str, Any]
    agent_id: str = "meta"


IMAGE_PRODUCING_TOOL_NAMES = frozenset({"generate_image", "show_images"})


def _safe_http_url(raw: Any) -> str:
    from agenticx.tools.show_images import normalize_http_url

    return normalize_http_url(raw)


def image_content_block_id(tool_call_id: str, index: Optional[int] = None) -> str:
    """Stable image block id: ``img-<tool_call_id>`` or ``img-<tool_call_id>-<index>``."""
    tid = str(tool_call_id or "").strip()
    base = f"img-{tid}" if tid else "img-unknown"
    if index is None:
        return base
    return f"{base}-{int(index)}"


def is_image_producing_tool(tool_name: str) -> bool:
    return str(tool_name or "").strip() in IMAGE_PRODUCING_TOOL_NAMES


def parse_image_tool_result(raw: Any) -> Dict[str, Any] | None:
    """Parse a generate_image / single-image JSON result. Returns None if not an image payload."""
    text = str(raw or "").strip()
    if not text or text.startswith("ERROR:"):
        return None
    try:
        parsed = json.loads(text)
    except Exception:
        return None
    if not isinstance(parsed, dict):
        return None
    if str(parsed.get("type") or "").strip() != "image":
        return None
    out = dict(parsed)
    url = _safe_http_url(out.get("url"))
    if url:
        out["url"] = url
    else:
        out.pop("url", None)
    source_url = _safe_http_url(out.get("source_url"))
    if source_url:
        out["source_url"] = source_url
    else:
        out.pop("source_url", None)
    return out


def parse_image_gallery_result(raw: Any) -> List[Dict[str, Any]]:
    """Parse show_images JSON. Illegal urls are skipped."""
    text = str(raw or "").strip()
    if not text or text.startswith("ERROR:"):
        return []
    try:
        parsed = json.loads(text)
    except Exception:
        return []
    if not isinstance(parsed, dict):
        return []
    if str(parsed.get("type") or "").strip() != "image_gallery":
        return []
    images = parsed.get("images")
    if not isinstance(images, list):
        return []
    out: List[Dict[str, Any]] = []
    for img in images:
        if not isinstance(img, dict):
            continue
        url = _safe_http_url(img.get("url"))
        if not url:
            continue
        row: Dict[str, Any] = {"type": "image", "url": url}
        alt = str(img.get("alt") or "").strip()
        if alt:
            row["alt"] = alt
        source_url = _safe_http_url(img.get("source_url"))
        if source_url:
            row["source_url"] = source_url
        out.append(row)
    return out


def _truncate_alt(prompt: str, limit: int = 80) -> str:
    text = str(prompt or "").strip()
    if len(text) <= limit:
        return text
    return text[: limit - 1] + "…"


def _preview_show_items(arguments: Any) -> List[Dict[str, Any]]:
    from agenticx.tools.show_images import preview_show_images_items

    items = arguments.get("items") if isinstance(arguments, dict) else None
    return preview_show_images_items(items)


def build_content_block_start_event(
    *,
    tool_call_id: str,
    prompt: str = "",
    agent_id: str = "meta",
    index: Optional[int] = None,
    kind: Optional[str] = None,
) -> RuntimeEvent:
    """SSE start frame: skeleton only, no path / url / bytes."""
    block: Dict[str, Any] = {
        "type": "image",
        "id": image_content_block_id(tool_call_id, index),
        "status": "generating",
        "alt": _truncate_alt(prompt),
        "source": "tool",
    }
    resolved_kind = str(kind or "").strip()
    if resolved_kind in {"remote", "generated"}:
        block["kind"] = resolved_kind
    return RuntimeEvent(
        type=EventType.CONTENT_BLOCK.value,
        data={"mode": "start", "block": block},
        agent_id=agent_id,
    )


def build_content_block_end_event(
    *,
    tool_call_id: str,
    result: Any = None,
    prompt: str = "",
    status: str | None = None,
    error: str = "",
    agent_id: str = "meta",
    index: Optional[int] = None,
    kind: Optional[str] = None,
) -> RuntimeEvent:
    """SSE end frame: ready / error / cancelled. Never includes image bytes."""
    parsed = parse_image_tool_result(result)
    raw = str(result or "")
    resolved_status = (status or "").strip()
    if not resolved_status:
        if parsed and str(parsed.get("status") or "").strip() == "error":
            resolved_status = "error"
        elif raw.startswith("ERROR:"):
            resolved_status = "error"
        elif parsed:
            resolved_status = "ready"
        else:
            resolved_status = "error"
    if resolved_status not in {"ready", "error", "cancelled"}:
        resolved_status = "error"

    alt = _truncate_alt(str((parsed or {}).get("alt") or prompt))
    block: Dict[str, Any] = {
        "type": "image",
        "id": image_content_block_id(tool_call_id, index),
        "status": resolved_status,
        "source": "tool",
    }
    resolved_kind = str(kind or "").strip()
    if resolved_kind in {"remote", "generated"}:
        block["kind"] = resolved_kind
    if alt:
        block["alt"] = alt
    if resolved_status == "ready" and parsed:
        path = str(parsed.get("path") or "").strip()
        if path:
            block["path"] = path
        url = _safe_http_url((parsed or {}).get("url"))
        if url:
            block["url"] = url
        source_url = _safe_http_url((parsed or {}).get("source_url"))
        if source_url:
            block["source_url"] = source_url
        mime = str(parsed.get("mime") or "").strip()
        if mime:
            block["mime"] = mime
        for key in ("width", "height"):
            value = parsed.get(key)
            if isinstance(value, int):
                block[key] = value
    if resolved_status == "error":
        err = str(error or (parsed or {}).get("error") or "").strip()
        if not err and raw.startswith("ERROR:"):
            err = raw[len("ERROR:") :].strip() or "image_generation failed"
        block["error"] = err or "image_generation failed"
    return RuntimeEvent(
        type=EventType.CONTENT_BLOCK.value,
        data={"mode": "end", "block": block},
        agent_id=agent_id,
    )


def iter_content_block_start_events(
    tool_name: str,
    tool_call_id: str,
    arguments: Any = None,
    agent_id: str = "meta",
) -> Iterator[RuntimeEvent]:
    name = str(tool_name or "").strip()
    if name == "show_images":
        rows = _preview_show_items(arguments)
        if not rows:
            yield build_content_block_start_event(
                tool_call_id=tool_call_id,
                agent_id=agent_id,
                kind="remote",
            )
            return
        for i, row in enumerate(rows):
            yield build_content_block_start_event(
                tool_call_id=tool_call_id,
                prompt=str(row.get("alt") or ""),
                agent_id=agent_id,
                index=i,
                kind="remote",
            )
        return
    if is_image_producing_tool(name):
        prompt = ""
        if isinstance(arguments, dict):
            prompt = str(arguments.get("prompt") or "")
        yield build_content_block_start_event(
            tool_call_id=tool_call_id,
            prompt=prompt,
            agent_id=agent_id,
        )


def iter_content_block_end_events(
    tool_name: str,
    tool_call_id: str,
    arguments: Any = None,
    result: Any = None,
    status: str | None = None,
    error: str = "",
    agent_id: str = "meta",
) -> Iterator[RuntimeEvent]:
    name = str(tool_name or "").strip()
    raw = str(result or "")
    forced = str(status or "").strip()
    if name == "show_images":
        rows = _preview_show_items(arguments)
        gallery = parse_image_gallery_result(result)
        if forced in {"error", "cancelled"} or raw.startswith("ERROR:") or not gallery:
            slots: List[Dict[str, Any]] = rows or [{}]
            err = error or "没有可用的图片链接"
            for i, row in enumerate(slots):
                yield build_content_block_end_event(
                    tool_call_id=tool_call_id,
                    result=result,
                    prompt=str(row.get("alt") or ""),
                    status=forced if forced in {"error", "cancelled"} else "error",
                    error=err if forced != "cancelled" else error,
                    agent_id=agent_id,
                    index=i if rows else None,
                    kind="remote",
                )
            return
        for i, row in enumerate(gallery):
            yield build_content_block_end_event(
                tool_call_id=tool_call_id,
                result=json.dumps(row, ensure_ascii=False),
                prompt=str(row.get("alt") or ""),
                status="ready",
                agent_id=agent_id,
                index=i,
                kind="remote",
            )
        return
    if is_image_producing_tool(name) or parse_image_tool_result(result):
        prompt = ""
        if isinstance(arguments, dict):
            prompt = str(arguments.get("prompt") or "")
        yield build_content_block_end_event(
            tool_call_id=tool_call_id,
            result=result,
            prompt=prompt,
            status=status,
            error=error,
            agent_id=agent_id,
        )


def collect_image_blocks_from_tool_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Build persistable image blocks from current-turn tool chat_history rows."""
    blocks: List[Dict[str, Any]] = []
    seen: set[str] = set()
    for item in rows:
        if not isinstance(item, dict):
            continue
        if str(item.get("role") or "").strip() != "tool":
            continue
        name = str(item.get("tool_name") or item.get("name") or "").strip()
        content = item.get("content")
        parsed = parse_image_tool_result(content)
        gallery = parse_image_gallery_result(content)
        if not parsed and not gallery and name not in IMAGE_PRODUCING_TOOL_NAMES:
            continue
        tool_call_id = str(item.get("tool_call_id") or item.get("id") or "").strip()
        args = item.get("tool_args") if isinstance(item.get("tool_args"), dict) else {}
        for event in iter_content_block_end_events(
            tool_name=name,
            tool_call_id=tool_call_id,
            arguments=args,
            result=content,
        ):
            block = dict(event.data.get("block") or {})
            bid = str(block.get("id") or "")
            if not bid or bid in seen:
                continue
            seen.add(bid)
            persist = {
                "type": "image",
                "id": bid,
                "status": str(block.get("status") or "ready"),
            }
            for key in ("path", "url", "source_url", "mime", "alt", "width", "height", "source", "error", "kind"):
                if key in block and block[key] not in (None, ""):
                    persist[key] = block[key]
            blocks.append(persist)
    return blocks
