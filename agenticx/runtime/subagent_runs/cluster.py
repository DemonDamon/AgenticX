#!/usr/bin/env python3
"""Cluster grouping helpers for sub-agent run persistence.

Author: Damon Li
"""

from __future__ import annotations

import time
import uuid
from typing import Optional


def build_cluster_id(
    owner_session_id: str,
    *,
    source_tool_call_id: str = "",
    now: Optional[float] = None,
) -> str:
    """Build a deterministic-ish cluster id with session + tool-batch hint."""
    stamp = int((now or time.time()) * 1000)
    safe_owner = (owner_session_id or "session").strip() or "session"
    safe_source = (source_tool_call_id or "").strip()
    if safe_source:
        return f"cl-{safe_owner}-{safe_source}-{stamp}"
    return f"cl-{safe_owner}-{uuid.uuid4().hex[:8]}-{stamp}"

