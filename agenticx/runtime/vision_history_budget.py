#!/usr/bin/env python3
"""Vision history budgeting helpers for image_inputs and persisted history.

Author: Damon Li
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Tuple

from agenticx.cli.config_manager import ConfigManager


_VISION_COUNTER_KEY = "__vision_history_total_images__"
_VISION_NOTICE_KEY = "__vision_budget_notice_sent__"


@dataclass
class VisionHistoryConfig:
    """Runtime vision history budget configuration."""

    enabled: bool = False
    max_images: int = 3
    max_image_chars_per_turn: int = 12_000
    degrade_mode: str = "keep_referenced"
    batch_compact_interval: int = 25
    placeholder_text: str = "[Image omitted]"


def _as_int(value: Any, default: int) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def load_vision_history_config() -> VisionHistoryConfig:
    """Load config from runtime.vision_history.*."""
    raw = ConfigManager.get_value("runtime.vision_history")
    if not isinstance(raw, dict):
        raw = {}
    return VisionHistoryConfig(
        enabled=bool(raw.get("enabled", False)),
        max_images=max(1, _as_int(raw.get("max_images", 3), 3)),
        max_image_chars_per_turn=max(1_000, _as_int(raw.get("max_image_chars_per_turn", 12_000), 12_000)),
        degrade_mode=str(raw.get("degrade_mode", "keep_referenced") or "keep_referenced").strip().lower(),
        batch_compact_interval=max(1, _as_int(raw.get("batch_compact_interval", 25), 25)),
        placeholder_text=str(raw.get("placeholder_text", "[Image omitted]") or "[Image omitted]").strip(),
    )


def apply_turn_image_budget(
    image_inputs: List[Dict[str, Any]],
    *,
    cfg: VisionHistoryConfig,
    user_input: str = "",
) -> Tuple[List[Dict[str, Any]], Dict[str, int | bool]]:
    """Budget image inputs for a single request."""
    stats: Dict[str, int | bool] = {
        "original_count": len(image_inputs),
        "kept_count": len(image_inputs),
        "dropped_count": 0,
        "omitted_for_budget": False,
    }
    if not cfg.enabled:
        return image_inputs, stats

    items = list(image_inputs)
    if len(items) > cfg.max_images:
        items = items[-cfg.max_images :]
        stats["omitted_for_budget"] = True

    total_chars = sum(len(str(x.get("data_url", "") or "")) for x in items)
    if total_chars > cfg.max_image_chars_per_turn:
        kept: List[Dict[str, Any]] = list(items)
        while kept and sum(len(str(x.get("data_url", "") or "")) for x in kept) > cfg.max_image_chars_per_turn:
            kept.pop(0)
        if kept != items:
            stats["omitted_for_budget"] = True
        items = kept

    stats["kept_count"] = len(items)
    stats["dropped_count"] = int(stats["original_count"]) - len(items)
    return items, stats


def maybe_batch_compact_session_images(
    session: Any,
    *,
    cfg: VisionHistoryConfig,
    new_image_count: int,
) -> Tuple[bool, int]:
    """Batch-compact old image payloads in session history.

    Returns:
        (did_compact, replaced_image_count)
    """
    if not cfg.enabled or new_image_count <= 0:
        return False, 0
    scratch = getattr(session, "scratchpad", None)
    if not isinstance(scratch, dict):
        return False, 0
    total = _as_int(scratch.get(_VISION_COUNTER_KEY, 0), 0) + new_image_count
    scratch[_VISION_COUNTER_KEY] = total
    if total % cfg.batch_compact_interval != 0:
        return False, 0

    attachment_refs: List[Dict[str, Any]] = []

    def _collect(container: List[Dict[str, Any]]) -> None:
        for row in container:
            atts = row.get("attachments")
            if not isinstance(atts, list):
                continue
            for att in atts:
                if not isinstance(att, dict):
                    continue
                data_url = str(att.get("data_url", "") or "")
                if data_url.startswith("data:image/"):
                    attachment_refs.append(att)

    _collect(getattr(session, "agent_messages", []) or [])
    _collect(getattr(session, "chat_history", []) or [])

    if len(attachment_refs) <= cfg.max_images:
        return False, 0

    keep_set = {id(x) for x in attachment_refs[-cfg.max_images :]}
    replaced = 0
    for att in attachment_refs:
        if id(att) in keep_set:
            continue
        if not str(att.get("data_url", "") or "").startswith("data:image/"):
            continue
        att["data_url"] = cfg.placeholder_text
        att["omitted"] = True
        replaced += 1
    return replaced > 0, replaced


def should_emit_budget_notice(session: Any) -> bool:
    """Return True only once per session for budget notice."""
    scratch = getattr(session, "scratchpad", None)
    if not isinstance(scratch, dict):
        return False
    if bool(scratch.get(_VISION_NOTICE_KEY, False)):
        return False
    scratch[_VISION_NOTICE_KEY] = True
    return True

