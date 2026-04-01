#!/usr/bin/env python3
"""Tencent SkillHub marketplace search for Machi / agx serve.

Attempts the local ``skillhub`` CLI (JSON output) when available; otherwise
falls back to ClawHub results from the user's configured registries, since
SkillHub mirrors that catalog.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def _search_via_skillhub_cli(query: str) -> List[Dict[str, Any]]:
    """Run ``skillhub search`` and parse JSON lines or a JSON array."""
    q = (query or "").strip()
    if not q:
        return []

    exe = shutil.which("skillhub")
    if not exe:
        return []

    argv_sets = (
        [exe, "search", q, "--json"],
        [exe, "search", q, "--format", "json"],
    )
    for argv in argv_sets:
        try:
            proc = subprocess.run(
                argv,
                capture_output=True,
                text=True,
                timeout=60,
                check=False,
            )
        except (OSError, subprocess.TimeoutExpired) as exc:
            logger.info("skillhub CLI search skipped: %s", exc)
            continue

        raw = (proc.stdout or "").strip()
        if proc.returncode != 0 or not raw:
            continue

        try:
            data = json.loads(raw)
        except json.JSONDecodeError:
            continue

        items: List[Dict[str, Any]] = []
        if isinstance(data, list):
            records = data
        elif isinstance(data, dict):
            records = data.get("items") or data.get("results") or data.get("skills") or []
            if not isinstance(records, list):
                continue
        else:
            continue

        for row in records:
            if not isinstance(row, dict):
                continue
            slug = str(row.get("slug") or row.get("name") or "").strip()
            if not slug:
                continue
            display = str(row.get("displayName") or row.get("title") or slug).strip()
            items.append(
                {
                    "slug": slug,
                    "name": display or slug,
                    "description": str(row.get("summary") or row.get("description") or "").strip(),
                    "version": str(row.get("version") or "latest"),
                    "author": str(row.get("author") or row.get("publisher") or "unknown"),
                    "downloads": row.get("downloads") or row.get("downloadCount"),
                }
            )
        if items:
            return items

    return []


def search_skillhub_market(query: str) -> Dict[str, Any]:
    """Return SkillHub-style search results for the Desktop UI.

    Args:
        query: Free-text search string.

    Returns:
        Dict with keys: ok, items (list of skill dicts), source, optional hint/error.
    """
    q = (query or "").strip()

    cli_items = _search_via_skillhub_cli(q)
    if cli_items:
        return {
            "ok": True,
            "items": cli_items,
            "count": len(cli_items),
            "source": "skillhub_cli",
            "hint": "",
        }

    try:
        from agenticx.extensions.registry_hub import RegistryHub

        hub = RegistryHub.from_config()
        results = hub.search(q)
    except Exception as exc:
        logger.warning("SkillHub fallback search failed: %s", exc)
        return {
            "ok": False,
            "items": [],
            "count": 0,
            "error": str(exc),
        }

    claw_only = [r for r in results if r.source_type == "clawhub"]
    items: List[Dict[str, Any]] = []
    for r in claw_only:
        extra = r.extra if isinstance(r.extra, dict) else {}
        downloads = extra.get("downloads") or extra.get("downloadCount")
        items.append(
            {
                "slug": r.name,
                "name": r.name,
                "description": r.description,
                "version": r.version,
                "author": r.author,
                "downloads": downloads,
            }
        )

    hint = ""
    if not items and not results:
        hint = (
            "未找到匹配技能。可在本机安装 SkillHub CLI 后重试，"
            "或前往 https://skillhub.tencent.com 浏览。"
        )
    elif not items and results:
        hint = (
            "当前注册表未返回 ClawHub 类结果。请在 ~/.agenticx/config.yaml 的 "
            "extensions.registries 中配置 type: clawhub 的源以启用镜像搜索。"
        )

    return {
        "ok": True,
        "items": items,
        "count": len(items),
        "source": "clawhub_fallback",
        "hint": hint,
    }
