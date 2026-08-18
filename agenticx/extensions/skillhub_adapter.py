#!/usr/bin/env python3
"""SkillHub marketplace search for Near / agx serve.

Uses SkillHub's public HTTP API first, then the configured ClawHub mirror and
finally the local ``skillhub`` CLI as compatibility fallbacks.  Search results
keep their namespace so the direct installer can request the exact package.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def _json_object(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return value
    if not isinstance(value, str) or not value.strip():
        return {}
    try:
        parsed = json.loads(value)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _optional_bool(*values: Any) -> bool | None:
    for value in values:
        if isinstance(value, bool):
            return value
        if not isinstance(value, str):
            continue
        normalized = value.strip().lower()
        if normalized in {"true", "1", "yes", "required"}:
            return True
        if normalized in {"false", "0", "no", "optional"}:
            return False
    return None


def _extract_market_metadata(row: Dict[str, Any]) -> Dict[str, Any]:
    """Flatten optional card metadata without inferring requirements from prose."""
    labels = _json_object(row.get("labels"))
    requires_api_key = _optional_bool(
        row.get("requires_api_key"),
        row.get("requiresApiKey"),
        row.get("api_key_required"),
        row.get("apiKeyRequired"),
        labels.get("requires_api_key"),
        labels.get("requiresApiKey"),
        labels.get("api_key_required"),
        labels.get("apiKeyRequired"),
    )
    detail_url = str(row.get("detail_url") or row.get("detailUrl") or "").strip()

    metadata: Dict[str, Any] = {}
    if requires_api_key is not None:
        metadata["requires_api_key"] = requires_api_key
    if detail_url.startswith(("http://", "https://")):
        metadata["detail_url"] = detail_url
    return metadata


def _search_via_skillhub_cli(
    query: str,
    *,
    install_source: str,
) -> List[Dict[str, Any]]:
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
                timeout=15,
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
            namespace_block = (
                row.get("namespace") if isinstance(row.get("namespace"), dict) else {}
            )
            namespace = str(
                namespace_block.get("handle")
                or row.get("namespace_handle")
                or row.get("namespaceHandle")
                or ""
            ).strip().lstrip("@")
            canonical_name = str(
                namespace_block.get("canonicalName")
                or row.get("canonical_name")
                or row.get("canonicalName")
                or (f"@{namespace}/{slug}" if namespace else slug)
            ).strip()
            display = str(row.get("displayName") or row.get("title") or slug).strip()
            item = {
                "slug": slug,
                "name": display or slug,
                "description": str(
                    row.get("summary") or row.get("description") or ""
                ).strip(),
                "version": str(row.get("version") or "latest"),
                "author": str(
                    row.get("author") or row.get("publisher") or "unknown"
                ),
                "downloads": (
                    row.get("downloads")
                    if "downloads" in row
                    else row.get("downloadCount")
                ),
                "icon_url": str(
                    row.get("icon_url") or row.get("iconUrl") or ""
                ).strip(),
                "source": install_source,
                "source_type": "skillhub",
                "origin_source": "skillhub_cli",
                "namespace": namespace,
                "canonical_name": canonical_name,
            }
            item.update(_extract_market_metadata(row))
            items.append(item)
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

    from agenticx.extensions.registry_hub import RegistryHub

    hub = RegistryHub.from_config()
    skillhub_source = hub.source_name_for_type("skillhub") or "skillhub"
    clawhub_source = hub.source_name_for_type("clawhub") or "clawhub"

    def _to_items(results: List[Any]) -> List[Dict[str, Any]]:
        items: List[Dict[str, Any]] = []
        for r in results:
            extra = r.extra if isinstance(r.extra, dict) else {}
            namespace_block = (
                extra.get("namespace") if isinstance(extra.get("namespace"), dict) else {}
            )
            namespace = str(
                namespace_block.get("handle")
                or extra.get("namespace_handle")
                or extra.get("namespaceHandle")
                or ""
            ).strip().lstrip("@")
            canonical_name = str(
                namespace_block.get("canonicalName")
                or extra.get("canonical_name")
                or extra.get("canonicalName")
                or (f"@{namespace}/{r.name}" if namespace else r.name)
            ).strip()
            downloads = (
                extra.get("downloads")
                if "downloads" in extra
                else extra.get("downloadCount")
            )
            icon_url = str(extra.get("icon_url") or extra.get("iconUrl") or "").strip()
            display_name = str(extra.get("display_name") or r.name).strip()
            item = {
                "slug": r.name,
                "name": display_name or r.name,
                "description": r.description,
                "version": r.version,
                "author": r.author,
                "downloads": downloads,
                "icon_url": icon_url,
                "source": r.source,
                "source_type": r.source_type,
                "origin_source": (
                    "skillhub_api"
                    if r.source_type == "skillhub"
                    else "clawhub_registry"
                    if r.source_type == "clawhub"
                    else r.source_type
                ),
                "namespace": namespace,
                "canonical_name": canonical_name,
            }
            item.update(_extract_market_metadata(extra))
            items.append(item)
        return items

    errors: List[str] = []
    try:
        native_results = hub.search_source(skillhub_source, q)
        native_items = _to_items(native_results)
        if native_items:
            return {
                "ok": True,
                "items": native_items,
                "count": len(native_items),
                "source": "skillhub_api",
                "hint": "",
            }
    except Exception as exc:
        errors.append(f"SkillHub: {exc}")
        logger.warning("SkillHub API search failed: %s", exc)

    try:
        mirror_results = hub.search_source(clawhub_source, q)
        mirror_items = _to_items(mirror_results)
        if mirror_items:
            return {
                "ok": True,
                "items": mirror_items,
                "count": len(mirror_items),
                "source": "clawhub_registry",
                "hint": "SkillHub 暂时不可用，当前结果来自兼容镜像。",
            }
    except Exception as exc:
        errors.append(f"ClawHub: {exc}")
        logger.warning("SkillHub mirror search failed: %s", exc)

    cli_items = _search_via_skillhub_cli(q, install_source=skillhub_source)
    if cli_items:
        return {
            "ok": True,
            "items": cli_items,
            "count": len(cli_items),
            "source": "skillhub_cli",
            "hint": "",
        }

    if errors:
        return {
            "ok": False,
            "items": [],
            "count": 0,
            "error": " | ".join(errors[:2]),
        }

    return {
        "ok": True,
        "items": [],
        "count": 0,
        "source": "skillhub_api",
        "hint": "未找到匹配技能。",
    }
