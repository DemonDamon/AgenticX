#!/usr/bin/env python3
"""FastAPI routes for web search configuration.

Author: Damon Li
"""

from __future__ import annotations

import copy
import logging
from typing import Any, Dict

from fastapi import FastAPI, HTTPException

from agenticx.cli.config_manager import ConfigManager
from agenticx.studio.web_search.contracts import WebSearchRuntimeConfig
from agenticx.studio.web_search.service import WebSearchService

logger = logging.getLogger(__name__)

_CONFIG_KEY = "web_search"


def _mask_secret(value: str) -> str:
    text = str(value or "")
    if len(text) <= 8:
        return "****" if text else ""
    return f"{text[:4]}...{text[-4:]}"


def _merged_config_dict() -> Dict[str, Any]:
    global_data = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
    project_data = ConfigManager._load_yaml(ConfigManager.PROJECT_CONFIG_PATH)
    return ConfigManager._deep_merge(global_data, project_data)


def _merge_web_search_write(existing: Dict[str, Any], incoming: Dict[str, Any]) -> Dict[str, Any]:
    """Depth-merge provider secrets so masked/empty fields do not wipe stored keys."""
    out = {**existing}
    for key in ("enabled", "default_provider", "max_results", "fetch_snippet_chars"):
        if key in incoming:
            out[key] = incoming[key]
    old_p = existing.get("providers") if isinstance(existing.get("providers"), dict) else {}
    new_p = incoming.get("providers") if isinstance(incoming.get("providers"), dict) else {}
    merged_p = dict(old_p)
    for pname, sub in new_p.items():
        if not isinstance(sub, dict):
            continue
        cur = dict(merged_p.get(pname) or {})
        for fld in ("api_key", "cx", "enabled"):
            if fld not in sub:
                continue
            val = sub[fld]
            if fld == "api_key" and isinstance(val, str):
                t = val.strip()
                if not t or "..." in t:
                    continue
            if fld == "cx" and isinstance(val, str):
                t = val.strip()
                if not t or "..." in t:
                    continue
            cur[fld] = val
        merged_p[pname] = cur
    out["providers"] = merged_p
    return out


def _client_shape(cfg: WebSearchRuntimeConfig) -> Dict[str, Any]:
    d = cfg.to_client_dict()
    prov = d.get("providers")
    if isinstance(prov, dict):
        masked = copy.deepcopy(prov)
        for key, sub in masked.items():
            if isinstance(sub, dict) and "api_key" in sub and isinstance(sub["api_key"], str):
                if sub["api_key"]:
                    sub["api_key"] = _mask_secret(sub["api_key"])
            if key == "google" and isinstance(sub, dict) and isinstance(sub.get("cx"), str):
                cx = sub.get("cx") or ""
                if len(cx) > 6:
                    sub["cx"] = f"{cx[:3]}...{cx[-3:]}"
        d["providers"] = masked
    return d


def register_web_search_routes(app: FastAPI) -> None:
    """Attach ``/api/web-search/*`` and related runtime UI routes."""

    if getattr(app.state, "_web_search_routes_registered", False):
        return
    app.state._web_search_routes_registered = True

    @app.get("/api/runtime/suggested-questions")
    async def read_suggested_questions_toggle() -> Dict[str, Any]:
        from agenticx.runtime.followup_stream import suggested_questions_enabled_from_config

        return {"ok": True, "enabled": suggested_questions_enabled_from_config()}

    @app.put("/api/runtime/suggested-questions")
    async def write_suggested_questions_toggle(payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        en = bool(payload.get("enabled", True))
        ConfigManager.set_value("runtime.suggested_questions.enabled", en)
        return {"ok": True, "enabled": en}

    @app.get("/api/web-search/config")
    async def read_web_search_config() -> Dict[str, Any]:
        raw = ConfigManager.get_value(_CONFIG_KEY)
        cfg = WebSearchRuntimeConfig.from_merged_yaml(raw if isinstance(raw, dict) else {})
        return {"ok": True, "config": _client_shape(cfg)}

    @app.put("/api/web-search/config")
    async def write_web_search_config(payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        existing = ConfigManager.get_value(_CONFIG_KEY)
        if not isinstance(existing, dict):
            existing = {}
        merged_payload = _merge_web_search_write(existing, payload)
        new_cfg = WebSearchRuntimeConfig.from_merged_yaml(merged_payload)
        data = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
        data[_CONFIG_KEY] = {
            "enabled": new_cfg.enabled,
            "default_provider": new_cfg.default_provider,
            "max_results": new_cfg.max_results,
            "fetch_snippet_chars": new_cfg.fetch_snippet_chars,
            "providers": dict(new_cfg.providers),
        }
        ConfigManager._dump_yaml(ConfigManager.GLOBAL_CONFIG_PATH, data)
        raw_read = ConfigManager.get_value(_CONFIG_KEY)
        cfg = WebSearchRuntimeConfig.from_merged_yaml(raw_read if isinstance(raw_read, dict) else {})
        return {"ok": True, "config": _client_shape(cfg)}

    @app.post("/api/web-search/test")
    async def test_web_search(payload: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(payload, dict):
            raise HTTPException(status_code=400, detail="expected JSON object")
        provider = str(payload.get("provider") or "").lower().strip()
        query = str(payload.get("query") or "AgenticX").strip() or "AgenticX"
        raw = ConfigManager.get_value(_CONFIG_KEY)
        base = WebSearchRuntimeConfig.from_merged_yaml(raw if isinstance(raw, dict) else {})
        try:
            svc = WebSearchService(base)
            hits = svc.search(query, max_results=1, provider_override=provider or None)
        except Exception as exc:
            logger.warning("web search test failed: %s", exc)
            return {"ok": False, "error": str(exc), "hits": []}
        return {
            "ok": bool(hits),
            "error": None if hits else "No results (check API key or query).",
            "hits": [
                {"title": h.title, "url": h.url, "snippet": h.snippet[:300]} for h in hits[:1]
            ],
        }
