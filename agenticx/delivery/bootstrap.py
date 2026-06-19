#!/usr/bin/env python3
"""Bootstrap delivery bundle, avatars, and MCP presets.

Author: Damon Li
"""

from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any

import yaml

from agenticx.avatar.registry import AVATARS_ROOT, AvatarConfig, AvatarRegistry
from agenticx.delivery.config import get_delivery_config

logger = logging.getLogger("agenticx.delivery.bootstrap")

BUNDLE_NAME = "agenticx-delivery-kit"
DELIVERY_AVATAR_IDS = (
    "delivery-analyst",
    "delivery-designer",
    "delivery-frontend",
    "delivery-qa",
)


def ensure_delivery_bundle() -> dict[str, Any]:
    """Install bundle and materialize delivery avatars if missing."""
    cfg = get_delivery_config()
    source = Path(str(cfg.get("bundle_source") or "")).expanduser()
    result: dict[str, Any] = {"ok": True, "bundle": None, "avatars": []}
    if not source.is_dir():
        result["ok"] = False
        result["error"] = f"bundle source not found: {source}"
        return result

    from agenticx.extensions.installer import install_bundle, list_installed_bundles

    installed = {b.name for b in list_installed_bundles()}
    if BUNDLE_NAME not in installed:
        install_result = install_bundle(source, auto_non_high=True)
        if not install_result.success:
            result["ok"] = False
            result["error"] = install_result.error or "bundle install failed"
            return result
        result["bundle"] = {
            "name": install_result.name,
            "version": install_result.version,
            "skills": install_result.skills_installed,
            "mcp_servers": install_result.mcp_servers_installed,
        }
    else:
        result["bundle"] = {"name": BUNDLE_NAME, "skipped": True}

    _apply_figma_token_to_mcp(str(cfg.get("figma_token") or ""))
    avatars = materialize_delivery_avatars(source)
    result["avatars"] = avatars
    return result


def materialize_delivery_avatars(bundle_source: Path) -> list[str]:
    """Copy preset YAML files into ~/.agenticx/avatars/<id>/avatar.yaml."""
    presets_dir = bundle_source / "avatars"
    registry = AvatarRegistry()
    created: list[str] = []
    for avatar_id in DELIVERY_AVATAR_IDS:
        preset = presets_dir / f"{avatar_id}.yaml"
        if not preset.is_file():
            logger.warning("Missing avatar preset: %s", preset)
            continue
        raw = yaml.safe_load(preset.read_text(encoding="utf-8")) or {}
        if not isinstance(raw, dict):
            continue
        raw["id"] = avatar_id
        avatar_dir = AVATARS_ROOT / avatar_id
        avatar_dir.mkdir(parents=True, exist_ok=True)
        dest = avatar_dir / "avatar.yaml"
        dest.write_text(yaml.dump(raw, sort_keys=False, allow_unicode=True), encoding="utf-8")
        if registry.get_avatar(avatar_id) is None:
            AvatarConfig.from_dict(raw)  # validate
        ws = str(raw.get("workspace_dir") or "").strip()
        if not ws:
            ws = str(avatar_dir / "workspace")
            raw["workspace_dir"] = ws
        Path(ws).mkdir(parents=True, exist_ok=True)
        created.append(avatar_id)
    return created


def _apply_figma_token_to_mcp(token: str) -> None:
    if not str(token or "").strip():
        return
    mcp_path = Path.home() / ".agenticx" / "mcp.json"
    if not mcp_path.is_file():
        return
    try:
        import json

        data = json.loads(mcp_path.read_text(encoding="utf-8"))
        servers = data.get("mcpServers") if isinstance(data, dict) else None
        if not isinstance(servers, dict):
            return
        entry = servers.get("figma-mcp")
        if not isinstance(entry, dict):
            return
        env = entry.setdefault("env", {})
        if isinstance(env, dict):
            env["FIGMA_API_KEY"] = token
            mcp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception:
        logger.debug("Failed to patch figma token into mcp.json", exc_info=True)
