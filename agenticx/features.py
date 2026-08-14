#!/usr/bin/env python3
"""Lightweight process feature switches shared by runtime entry points.

Author: Damon Li
"""

from __future__ import annotations

import os


_FALSE_VALUES = frozenset({"0", "false", "no", "off"})


def local_knowledge_enabled() -> bool:
    """Return whether local document-brain features are available.

    The generic runtime keeps the existing enabled-by-default behavior. Customer
    Desktop entry points explicitly set ``AGX_LOCAL_KNOWLEDGE_ENABLED=0`` before
    importing Studio, so their process never registers or advertises the local
    knowledge surface.
    """

    raw = os.getenv("AGX_LOCAL_KNOWLEDGE_ENABLED")
    if raw is None:
        return True
    return raw.strip().lower() not in _FALSE_VALUES
