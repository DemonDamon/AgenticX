#!/usr/bin/env python3
"""Static catalog of known data source plugins (for status UI and defaults).

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, List

DATA_SOURCE_CATALOG: List[Dict[str, Any]] = [
    {
        "name": "akshare",
        "display_name": "AkShare（免费行情）",
        "domain": "finance",
        "requires_credential": False,
        "default_enabled": True,
    },
    {
        "name": "world_bank",
        "display_name": "World Bank（宏观指标）",
        "domain": "macro",
        "requires_credential": False,
        "default_enabled": True,
    },
    {
        "name": "imf",
        "display_name": "IMF DataMapper（宏观指标）",
        "domain": "macro",
        "requires_credential": False,
        "default_enabled": True,
    },
    {
        "name": "tushare",
        "display_name": "Tushare Pro（经 MCP 桥接）",
        "domain": "finance",
        "requires_credential": True,
        "default_enabled": False,
        "mcp_server": "tushareMcp",
    },
    {
        "name": "ifind",
        "display_name": "同花顺 iFinD（需企业授权）",
        "domain": "finance",
        "requires_credential": True,
        "default_enabled": False,
        "stub_only": True,
    },
]

DEFAULT_DATA_SOURCES: Dict[str, Dict[str, Any]] = {
    entry["name"]: {"enabled": bool(entry.get("default_enabled", False))}
    for entry in DATA_SOURCE_CATALOG
}
