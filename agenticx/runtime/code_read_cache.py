#!/usr/bin/env python3
"""Track file_read ranges in session scratchpad for code_dev mode.

Author: Damon Li
"""

from __future__ import annotations

import hashlib
import json
import time
from pathlib import Path
from typing import Any

from agenticx.runtime.session_mode import READ_FILES_SCRATCH_PREFIX, is_code_dev

_MAX_READ_FILE_ENTRIES = 30


def _path_key(path: str) -> str:
    digest = hashlib.sha1(path.encode("utf-8", errors="replace")).hexdigest()[:8]
    return f"{READ_FILES_SCRATCH_PREFIX}{digest}"


def _merge_ranges(existing: list[tuple[int, int]], start: int, end: int) -> list[tuple[int, int]]:
    ranges = list(existing) + [(start, end)]
    ranges.sort()
    merged: list[tuple[int, int]] = []
    for s, e in ranges:
        if not merged or s > merged[-1][1] + 1:
            merged.append((s, e))
        else:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
    return merged[:5]


def record_file_read(
    session: Any,
    path: Path,
    *,
    start_line: int | None,
    end_line: int | None,
    total_lines: int,
) -> None:
    if not is_code_dev(session):
        return
    scratch = getattr(session, "scratchpad", None)
    if not isinstance(scratch, dict):
        session.scratchpad = {}
        scratch = session.scratchpad
    resolved = str(path.resolve())
    key = _path_key(resolved)
    raw = scratch.get(key)
    try:
        entry = json.loads(raw) if isinstance(raw, str) and raw.startswith("{") else {}
    except json.JSONDecodeError:
        entry = {}
    if not isinstance(entry, dict):
        entry = {}
    ranges_raw = entry.get("ranges") or []
    ranges: list[tuple[int, int]] = []
    for item in ranges_raw:
        if isinstance(item, (list, tuple)) and len(item) == 2:
            ranges.append((int(item[0]), int(item[1])))
    if start_line is not None and end_line is not None:
        ranges = _merge_ranges(ranges, start_line, end_line)
    elif total_lines > 0:
        ranges = _merge_ranges(ranges, 1, total_lines)
    entry.update({
        "path": resolved,
        "lines": total_lines,
        "read_at": time.time(),
        "ranges": ranges,
    })
    scratch[key] = json.dumps(entry, ensure_ascii=False)
    _prune_read_files(scratch)


def _prune_read_files(scratch: dict[str, str]) -> None:
    keys = [k for k in scratch if k.startswith(READ_FILES_SCRATCH_PREFIX)]
    if len(keys) <= _MAX_READ_FILE_ENTRIES:
        return
    keyed: list[tuple[float, str]] = []
    for k in keys:
        try:
            data = json.loads(scratch[k])
            keyed.append((float(data.get("read_at", 0)), k))
        except (json.JSONDecodeError, TypeError, ValueError):
            keyed.append((0.0, k))
    keyed.sort()
    for _, k in keyed[: len(keys) - _MAX_READ_FILE_ENTRIES]:
        scratch.pop(k, None)


def build_read_files_block(session: Any) -> str:
    if not is_code_dev(session):
        return ""
    scratch = getattr(session, "scratchpad", None) or {}
    if not isinstance(scratch, dict):
        return ""
    lines = ["## 已读文件清单（code_dev，最多 30 条）"]
    entries: list[tuple[float, str]] = []
    for key, raw in scratch.items():
        if not key.startswith(READ_FILES_SCRATCH_PREFIX):
            continue
        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue
        path = str(data.get("path", ""))
        ranges = data.get("ranges") or []
        read_at = float(data.get("read_at", 0))
        if not path:
            continue
        range_txt = ", ".join(f"{a}-{b}" for a, b in ranges[:5]) if ranges else "整文件"
        from datetime import datetime
        ts = datetime.fromtimestamp(read_at).strftime("%H:%M") if read_at else "?"
        entries.append((read_at, f"- {path} (lines {range_txt}) · 读于 {ts}"))
    if not entries:
        return "- （尚无 file_read 记录）\n"
    entries.sort(key=lambda x: x[0], reverse=True)
    lines.extend(e[1] for e in entries[:30])
    lines.append(
        "提示：同一文件若已读过且未变更，优先用 scratchpad 摘要或 code_outline，避免重复整文件 file_read。\n"
    )
    return "\n".join(lines) + "\n"
