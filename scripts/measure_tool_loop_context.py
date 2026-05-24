#!/usr/bin/env python3
"""Measure tool-loop context bloat for a single AgenticX session.

This baseline script reads ``~/.agenticx/sessions/<sid>/messages.json`` and
emits a markdown report quantifying how tool results accumulate in the
assistant's chat history across rounds. The report is the canonical baseline
input for plan ``2026-05-24-tool-loop-context-budget``.

Token counts are approximated as ``len(text) / 4`` to match the heuristic
used by :mod:`agenticx.core.overflow_recovery`, keeping the script
stdlib-only (no tiktoken/transformers dependency).

Usage:
    python3 scripts/measure_tool_loop_context.py <session_id> [--out PATH]
    python3 scripts/measure_tool_loop_context.py <session_id> --json

Author: Damon Li
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional


def approx_tokens(text: str) -> int:
    """Approximate token count, matching overflow_recovery heuristic."""
    if not text:
        return 0
    return max(1, len(text) // 4)


@dataclass
class RoundStats:
    """Per-round aggregates for the report."""

    round_idx: int
    assistant_msg_id: Optional[str]
    assistant_chars: int = 0
    assistant_tokens: int = 0
    has_think_block: bool = False
    tool_calls: List[str] = field(default_factory=list)
    tool_result_chars: int = 0
    tool_result_tokens: int = 0
    tool_results: List[Dict[str, Any]] = field(default_factory=list)
    errors: List[str] = field(default_factory=list)
    anchor_seen: bool = False
    anchor_mode: Optional[str] = None


@dataclass
class SessionStats:
    """Whole-session aggregates."""

    session_id: str
    session_path: Path
    total_messages: int = 0
    role_counts: Counter = field(default_factory=Counter)
    rounds: List[RoundStats] = field(default_factory=list)
    tool_call_counts: Counter = field(default_factory=Counter)
    error_counts: Counter = field(default_factory=Counter)
    largest_tool_results: List[Dict[str, Any]] = field(default_factory=list)
    cumulative_tool_tokens: List[int] = field(default_factory=list)
    user_first_message: str = ""
    walltime_terminations: int = 0


ANCHOR_PATTERN = re.compile(r"\[user-goal-anchor\]")
THINK_PATTERN = re.compile(r"<think>", re.IGNORECASE)
ERROR_PATTERNS = [
    ("skill_already_exists", re.compile(r"ERROR:\s*skill already exists", re.IGNORECASE)),
    ("walltime_stop", re.compile(r"max_wall_clock_hours", re.IGNORECASE)),
    ("budget_exceeded", re.compile(r"Token budget exceeded", re.IGNORECASE)),
    ("guard_rejected", re.compile(r"guard rejected", re.IGNORECASE)),
    ("path_escapes", re.compile(r"path escapes workspace", re.IGNORECASE)),
    ("cancelled", re.compile(r"^CANCELLED:", re.MULTILINE)),
    ("generic_error", re.compile(r"^ERROR:", re.MULTILINE)),
]


def detect_errors(text: str) -> List[str]:
    """Tag a tool result with all matching error categories."""
    if not text:
        return []
    hits: List[str] = []
    for label, pattern in ERROR_PATTERNS:
        if pattern.search(text):
            hits.append(label)
    return hits


def detect_anchor_mode(content: str) -> Optional[str]:
    """Infer which user-goal-anchor variant is embedded (if any)."""
    if not ANCHOR_PATTERN.search(content):
        return None
    if "用户当前原始问题（一字不差，禁止改写）" in content:
        return "complex"
    if "用户当前原始问题" in content:
        return "middle"
    return "minimal"


def load_session(session_id: str, sessions_root: Path) -> SessionStats:
    """Parse messages.json into a SessionStats object."""
    session_dir = sessions_root / session_id
    msg_file = session_dir / "messages.json"
    if not msg_file.is_file():
        raise FileNotFoundError(f"messages.json not found at {msg_file}")
    with msg_file.open(encoding="utf-8") as fh:
        msgs = json.load(fh)
    if not isinstance(msgs, list):
        raise ValueError(f"messages.json is not a list: {msg_file}")

    stats = SessionStats(session_id=session_id, session_path=session_dir)
    stats.total_messages = len(msgs)

    current: Optional[RoundStats] = None
    cumulative_tokens = 0

    for msg in msgs:
        role = str(msg.get("role", "")).lower()
        stats.role_counts[role] += 1
        content = str(msg.get("content", "") or "")

        if role == "user":
            if not stats.user_first_message:
                stats.user_first_message = content[:200]
            continue

        if role == "assistant":
            if current is not None:
                stats.rounds.append(current)
            current = RoundStats(
                round_idx=len(stats.rounds) + 1,
                assistant_msg_id=str(msg.get("id") or "") or None,
            )
            current.assistant_chars = len(content)
            current.assistant_tokens = approx_tokens(content)
            current.has_think_block = bool(THINK_PATTERN.search(content))
            mode = detect_anchor_mode(content)
            if mode is not None:
                current.anchor_seen = True
                current.anchor_mode = mode
            continue

        if role == "tool":
            if current is None:
                current = RoundStats(round_idx=len(stats.rounds) + 1, assistant_msg_id=None)
            tool_name = str(msg.get("tool_name") or "<unknown>")
            current.tool_calls.append(tool_name)
            stats.tool_call_counts[tool_name] += 1
            tokens = approx_tokens(content)
            current.tool_result_chars += len(content)
            current.tool_result_tokens += tokens
            cumulative_tokens += tokens
            errors = detect_errors(content)
            for err in errors:
                stats.error_counts[err] += 1
                if err == "walltime_stop":
                    stats.walltime_terminations += 1
            current.errors.extend(errors)
            current.tool_results.append({
                "tool_name": tool_name,
                "chars": len(content),
                "tokens": tokens,
                "errors": errors,
                "tool_status": str(msg.get("tool_status") or ""),
            })
            stats.largest_tool_results.append({
                "round": current.round_idx,
                "tool": tool_name,
                "tokens": tokens,
                "preview": content[:120].replace("\n", " "),
            })

    if current is not None:
        stats.rounds.append(current)

    cum = 0
    for rnd in stats.rounds:
        cum += rnd.tool_result_tokens
        stats.cumulative_tool_tokens.append(cum)

    stats.largest_tool_results.sort(key=lambda x: x["tokens"], reverse=True)
    stats.largest_tool_results = stats.largest_tool_results[:10]
    return stats


def render_markdown(stats: SessionStats) -> str:
    """Render the SessionStats as a human-readable markdown report."""
    lines: List[str] = []
    lines.append(f"# Tool-Loop Context Baseline — {stats.session_id}")
    lines.append("")
    lines.append(f"- Session path: `{stats.session_path}`")
    lines.append(f"- Total messages: **{stats.total_messages}**")
    lines.append(
        f"- Roles: user={stats.role_counts.get('user', 0)}, "
        f"assistant={stats.role_counts.get('assistant', 0)}, "
        f"tool={stats.role_counts.get('tool', 0)}"
    )
    lines.append(f"- Total assistant rounds: **{len(stats.rounds)}**")
    total_tool_tokens = sum(r.tool_result_tokens for r in stats.rounds)
    lines.append(f"- Cumulative tool_result tokens: **{total_tool_tokens:,}** (approx, len/4)")
    lines.append(f"- Walltime terminations detected: {stats.walltime_terminations}")
    lines.append("")

    if stats.user_first_message:
        snippet = stats.user_first_message.replace("\n", " ")
        lines.append(f"**First user message**: {snippet}")
        lines.append("")

    lines.append("## Tool call distribution")
    lines.append("")
    lines.append("| Tool | Calls |")
    lines.append("|------|------:|")
    for tool, count in stats.tool_call_counts.most_common():
        lines.append(f"| `{tool}` | {count} |")
    lines.append("")

    if stats.error_counts:
        lines.append("## Error categories")
        lines.append("")
        lines.append("| Category | Hits |")
        lines.append("|----------|-----:|")
        for cat, count in stats.error_counts.most_common():
            lines.append(f"| {cat} | {count} |")
        lines.append("")

    lines.append("## Per-round breakdown")
    lines.append("")
    lines.append(
        "| # | Tools | tool_result tokens | cumulative | think | anchor | errors |"
    )
    lines.append("|---:|-------|------:|------:|:-----:|:------:|--------|")
    for rnd, cum in zip(stats.rounds, stats.cumulative_tool_tokens):
        tools = ",".join(rnd.tool_calls) if rnd.tool_calls else "—"
        if len(tools) > 60:
            tools = tools[:57] + "..."
        think = "Y" if rnd.has_think_block else ""
        if rnd.anchor_mode:
            anchor = rnd.anchor_mode
        elif rnd.anchor_seen:
            anchor = "Y"
        else:
            anchor = ""
        errs = ",".join(sorted(set(rnd.errors))) if rnd.errors else ""
        lines.append(
            f"| {rnd.round_idx} | {tools} | {rnd.tool_result_tokens:,} | "
            f"{cum:,} | {think} | {anchor} | {errs} |"
        )
    lines.append("")

    lines.append("## Top 10 largest tool results")
    lines.append("")
    lines.append("| Round | Tool | Tokens | Preview |")
    lines.append("|------:|------|------:|---------|")
    for item in stats.largest_tool_results:
        preview = item["preview"].replace("|", "\\|")
        lines.append(
            f"| {item['round']} | `{item['tool']}` | {item['tokens']:,} | {preview} |"
        )
    lines.append("")

    lines.append("## Anchor presence summary")
    lines.append("")
    anchor_modes = Counter(r.anchor_mode for r in stats.rounds if r.anchor_mode)
    rounds_with_anchor = sum(1 for r in stats.rounds if r.anchor_seen)
    lines.append(f"- Rounds with `[user-goal-anchor]` in assistant content: {rounds_with_anchor}/{len(stats.rounds)}")
    if anchor_modes:
        for mode, count in anchor_modes.most_common():
            lines.append(f"  - mode `{mode}`: {count}")
    else:
        lines.append("  - (none observed in stored assistant content; anchor lives in the prompt-level system messages, not assistant outputs)")
    lines.append("")

    lines.append("## Notes & caveats")
    lines.append("")
    lines.append(
        "- Token counts are approximate (`len(text) // 4`); use a tokenizer-backed pass if precise budget alignment is needed."
    )
    lines.append(
        "- `[user-goal-anchor]` is injected into the LLM request's system messages, not into persisted assistant content. "
        "Its presence in this report only reflects cases where the model echoed the anchor in its own output."
    )
    lines.append(
        "- Rounds are aligned to assistant messages; tool results without a preceding assistant message in this session are bucketed into the next round."
    )
    return "\n".join(lines).rstrip() + "\n"


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n", 1)[0])
    parser.add_argument("session_id", help="Session UUID under ~/.agenticx/sessions/")
    parser.add_argument(
        "--sessions-root",
        default=str(Path.home() / ".agenticx" / "sessions"),
        help="Override sessions root (default: ~/.agenticx/sessions)",
    )
    parser.add_argument(
        "--out",
        default=None,
        help="Output markdown path. Default: docs/perf/tool-loop-baseline-<sid8>.md",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Print JSON summary to stdout instead of writing markdown.",
    )
    args = parser.parse_args(argv)

    sessions_root = Path(args.sessions_root).expanduser()
    stats = load_session(args.session_id, sessions_root)

    if args.json:
        summary = {
            "session_id": stats.session_id,
            "total_messages": stats.total_messages,
            "role_counts": dict(stats.role_counts),
            "rounds": len(stats.rounds),
            "cumulative_tool_tokens": sum(r.tool_result_tokens for r in stats.rounds),
            "tool_call_counts": dict(stats.tool_call_counts),
            "error_counts": dict(stats.error_counts),
            "walltime_terminations": stats.walltime_terminations,
            "largest_tool_results": stats.largest_tool_results,
        }
        json.dump(summary, sys.stdout, ensure_ascii=False, indent=2)
        sys.stdout.write("\n")
        return 0

    markdown = render_markdown(stats)
    if args.out:
        out_path = Path(args.out).expanduser()
    else:
        out_path = Path("docs") / "perf" / f"tool-loop-baseline-{args.session_id[:8]}.md"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(markdown, encoding="utf-8")
    print(f"baseline report written to {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
