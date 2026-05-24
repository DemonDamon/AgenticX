#!/usr/bin/env python3
"""Tool-loop context budget: archive, classify, and decay old tool results.

Author: Damon Li
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# Per-tool result size class for budget decay (default: medium).
TOOL_RESULT_CLASS: Dict[str, str] = {
    "scratchpad_read": "small",
    "memory_search": "small",
    "session_search": "small",
    "skill_list": "small",
    "todo_write": "small",
    "list_scheduled_tasks": "small",
    "get_automation_task_logs": "small",
    "file_read": "large",
    "bash_exec": "large",
    "liteparse": "large",
    "code_search": "medium",
    "mcp_call": "medium",
    "web_search": "medium",
    "skill_import_repo": "medium",
    "desktop_screenshot": "blob",
    "screencapture": "blob",
}


def approx_tokens(text: str) -> int:
    """Approximate token count (len/4), aligned with overflow_recovery heuristic."""
    if not text:
        return 0
    return max(0, len(text) // 4)


def get_result_class(tool_name: str, content: str = "") -> str:
    """Resolve result class for a tool; infer large from content when unmapped."""
    cls = TOOL_RESULT_CLASS.get(str(tool_name or "").strip(), "medium")
    if cls == "medium" and approx_tokens(content) >= 4000:
        return "large"
    return cls


@dataclass
class ToolResultBudgetConfig:
    """Runtime knobs for tool-result budget governance."""

    enabled: bool = True
    keep_rounds: int = 2
    large_threshold_tokens: int = 4000
    archive_subdir: str = "tool_archives"


@dataclass
class ApplyBudgetStats:
    """Summary returned by apply_tool_result_budget."""

    archived_replaced: int = 0
    tool_result_tokens_round: int = 0
    tool_result_tokens_session: int = 0


@dataclass
class ToolResultMeta:
    """Metadata for one tool result entry."""

    round_idx: int
    tool_name: str
    result_class: str
    original_chars: int
    archive_path: Optional[str] = None
    one_line_summary: str = ""


def load_config() -> ToolResultBudgetConfig:
    """Load config from env and ~/.agenticx/config.yaml runtime.tool_result_budget."""
    import os

    cfg = ToolResultBudgetConfig()
    raw_enabled = os.environ.get("AGX_TOOL_RESULT_BUDGET_ENABLED", "").strip().lower()
    if raw_enabled in {"0", "false", "no", "off"}:
        cfg.enabled = False
    elif raw_enabled in {"1", "true", "yes", "on"}:
        cfg.enabled = True
    raw_keep = os.environ.get("AGX_TOOL_RESULT_KEEP_ROUNDS", "").strip()
    if raw_keep:
        try:
            cfg.keep_rounds = max(0, int(raw_keep))
        except ValueError:
            pass
    try:
        from agenticx.cli.config_manager import ConfigManager

        section = ConfigManager.get_value("runtime.tool_result_budget")
        if isinstance(section, dict):
            if "enabled" in section:
                cfg.enabled = bool(section["enabled"])
            if section.get("keep_rounds") is not None:
                cfg.keep_rounds = max(0, int(section["keep_rounds"]))
            if section.get("large_threshold_tokens") is not None:
                cfg.large_threshold_tokens = max(500, int(section["large_threshold_tokens"]))
            sub = str(section.get("archive_subdir") or "").strip()
            if sub:
                cfg.archive_subdir = sub
    except Exception:
        pass
    return cfg


def _session_archive_dir(session: Any, cfg: ToolResultBudgetConfig) -> Optional[Path]:
    sid = getattr(session, "_session_id", None) or getattr(session, "session_id", None)
    text = str(sid or "").strip()
    if not text:
        return None
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("_") or text
    sub = str(cfg.archive_subdir or "tool_archives").strip() or "tool_archives"
    return Path.home() / ".agenticx" / "sessions" / safe / sub


def _safe_call_id(tool_call_id: str) -> str:
    safe = re.sub(r"[^a-zA-Z0-9_.-]+", "_", str(tool_call_id or "")).strip("_")
    return safe or "unknown"


def _one_line_summary(tool_name: str, content: str) -> str:
    text = str(content or "").replace("\n", " ").strip()
    if len(text) > 160:
        text = text[:157] + "..."
    return f"{tool_name}: {text}" if text else tool_name


def archive_tool_result(
    session: Any,
    *,
    round_idx: int,
    tool_call_id: str,
    tool_name: str,
    content: str,
    cfg: Optional[ToolResultBudgetConfig] = None,
) -> Optional[Path]:
    """Persist original tool result text under the session tool_archives directory."""
    cfg = cfg or load_config()
    text = str(content or "")
    if not text:
        return None
    archive_dir = _session_archive_dir(session, cfg)
    if archive_dir is None:
        return None
    try:
        archive_dir.mkdir(parents=True, exist_ok=True)
    except OSError:
        return None
    fname = f"r{round_idx}-{_safe_call_id(tool_call_id)}-{tool_name}.txt"
    out_path = archive_dir / fname
    try:
        out_path.write_text(text, encoding="utf-8")
    except OSError:
        return None
    return out_path


def record_tool_result_meta(
    session: Any,
    *,
    round_idx: int,
    tool_call_id: str,
    tool_name: str,
    content: str,
    archive_path: Optional[Path] = None,
) -> None:
    """Store per-call metadata on the session for later budget decay."""
    store: Dict[str, ToolResultMeta] = getattr(session, "_tool_result_meta", None) or {}
    if not isinstance(store, dict):
        store = {}
    rclass = get_result_class(tool_name, content)
    store[str(tool_call_id)] = ToolResultMeta(
        round_idx=round_idx,
        tool_name=tool_name,
        result_class=rclass,
        original_chars=len(content),
        archive_path=str(archive_path) if archive_path else None,
        one_line_summary=_one_line_summary(tool_name, content),
    )
    session._tool_result_meta = store
    session._tool_result_tokens_session = (
        int(getattr(session, "_tool_result_tokens_session", 0) or 0) + approx_tokens(content)
    )


def _build_archived_summary(meta: ToolResultMeta) -> str:
    path_part = meta.archive_path or "(no archive path)"
    return (
        f"[tool-result-archived] tool={meta.tool_name} round_first_seen={meta.round_idx}\n"
        f"original_chars={meta.original_chars}, archived at {path_part}\n"
        f"one_line_summary: {meta.one_line_summary}"
    )


def apply_tool_result_budget(
    messages: List[Dict[str, Any]],
    *,
    current_round: int,
    session: Any,
    cfg: Optional[ToolResultBudgetConfig] = None,
) -> Tuple[List[Dict[str, Any]], ApplyBudgetStats]:
    """Return a copy of messages with aged large tool results replaced by summaries."""
    cfg = cfg or load_config()
    stats = ApplyBudgetStats(
        tool_result_tokens_session=int(getattr(session, "_tool_result_tokens_session", 0) or 0),
    )
    if not cfg.enabled:
        for msg in messages:
            if isinstance(msg, dict) and str(msg.get("role", "")).lower() == "tool":
                stats.tool_result_tokens_round += approx_tokens(str(msg.get("content", "")))
        return list(messages), stats

    meta_store: Dict[str, ToolResultMeta] = getattr(session, "_tool_result_meta", None) or {}
    if not isinstance(meta_store, dict):
        meta_store = {}

    out: List[Dict[str, Any]] = []
    for msg in messages:
        if not isinstance(msg, dict):
            out.append(msg)
            continue
        role = str(msg.get("role", "")).lower()
        if role != "tool":
            out.append(dict(msg))
            continue
        content = str(msg.get("content", "") or "")
        stats.tool_result_tokens_round += approx_tokens(content)
        tool_call_id = str(msg.get("tool_call_id") or msg.get("id") or "")
        tool_name = str(msg.get("name") or msg.get("tool_name") or "")
        meta = meta_store.get(tool_call_id)
        if meta is None:
            out.append(dict(msg))
            continue
        age = current_round - meta.round_idx
        should_archive = meta.result_class in {"large", "blob"} and age > cfg.keep_rounds
        if should_archive and "[tool-result-archived]" not in content:
            replaced = dict(msg)
            replaced["content"] = _build_archived_summary(meta)
            out.append(replaced)
            stats.archived_replaced += 1
        else:
            out.append(dict(msg))

    stats.tool_result_tokens_session = int(getattr(session, "_tool_result_tokens_session", 0) or 0)
    return out, stats


def persist_context_stats(session: Any, payload: Dict[str, Any]) -> None:
    """Append one context_stats line to the session directory."""
    sid = getattr(session, "_session_id", None) or getattr(session, "session_id", None)
    text = str(sid or "").strip()
    if not text:
        return
    safe = re.sub(r"[^A-Za-z0-9_.-]+", "_", text).strip("_") or text
    out_path = Path.home() / ".agenticx" / "sessions" / safe / "context_stats.jsonl"
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with out_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(payload, ensure_ascii=False) + "\n")
    except OSError:
        pass
