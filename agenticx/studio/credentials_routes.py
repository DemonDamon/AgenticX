#!/usr/bin/env python3
"""HTTP routes for the local credential store.

Responses never include secret values.

Author: Damon Li
"""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Callable, Optional

from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

from agenticx.cli.config_manager import ConfigManager
from agenticx.runtime.credential_store import (
    NAME_RE,
    CredentialError,
    CredentialMeta,
    default_store,
    find_references,
)

logger = logging.getLogger(__name__)


class CredentialUpsert(BaseModel):
    value: Optional[str] = None
    description: Optional[str] = None


def _public_meta(meta: CredentialMeta, referenced_by: list[str] | None = None) -> dict:
    payload = {
        "name": meta.name,
        "description": meta.description,
        "updated_at": meta.updated_at,
    }
    if referenced_by is not None:
        payload["referenced_by"] = referenced_by
    return payload


def _absorb(found: dict[str, list[str]], text: object, label: str) -> None:
    if not isinstance(text, str) or "${cred:" not in text:
        return
    for name in find_references(text):
        labels = found.setdefault(name, [])
        if label not in labels:
            labels.append(label)


def credential_references() -> dict[str, list[str]]:
    """Map credential names to ``mcp:<server>`` and ``provider:<name>`` labels.

    Scans ``~/.agenticx/mcp.json`` env/headers and provider ``api_key`` /
    ``secret_key`` in the global config. Missing or unreadable files contribute
    nothing.
    """

    found: dict[str, list[str]] = {}
    mcp_path = Path.home() / ".agenticx" / "mcp.json"
    if mcp_path.is_file():
        try:
            raw = json.loads(mcp_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            raw = None
        servers: object = None
        if isinstance(raw, dict):
            nested = raw.get("mcpServers")
            servers = nested if isinstance(nested, dict) else raw
        if isinstance(servers, dict):
            for server_name, spec in servers.items():
                if not isinstance(spec, dict):
                    continue
                label = f"mcp:{server_name}"
                for section in ("env", "headers"):
                    mapping = spec.get(section)
                    if not isinstance(mapping, dict):
                        continue
                    for value in mapping.values():
                        _absorb(found, value, label)

    try:
        doc = ConfigManager._load_yaml(ConfigManager.GLOBAL_CONFIG_PATH)
    except Exception:
        logger.warning("credential reference scan skipped unreadable provider config")
        doc = {}
    providers = doc.get("providers") if isinstance(doc, dict) else None
    if isinstance(providers, dict):
        for provider_name, spec in providers.items():
            if not isinstance(spec, dict):
                continue
            label = f"provider:{provider_name}"
            _absorb(found, spec.get("api_key"), label)
            _absorb(found, spec.get("secret_key"), label)
    return found


def _http_credential_error(exc: CredentialError) -> HTTPException:
    text = str(exc)
    if text.startswith("invalid credential name") or text.startswith("value is required"):
        return HTTPException(status_code=400, detail=text)
    return HTTPException(status_code=500, detail=text)


def register_credentials_routes(
    app: FastAPI,
    check_token: Callable[[Optional[str]], None],
) -> None:
    """Attach credential list, upsert, and delete routes."""

    @app.get("/api/credentials")
    async def list_credentials(
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict:
        check_token(x_agx_desktop_token)
        try:
            metas = default_store().list()
            refs = credential_references()
        except CredentialError as exc:
            raise _http_credential_error(exc) from exc
        return {
            "ok": True,
            "credentials": [
                _public_meta(meta, list(refs.get(meta.name, [])))
                for meta in metas
            ],
        }

    @app.put("/api/credentials/{name}")
    async def put_credential(
        name: str,
        body: CredentialUpsert,
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict:
        check_token(x_agx_desktop_token)
        try:
            meta = default_store().set(name, body.value, body.description)
        except CredentialError as exc:
            raise _http_credential_error(exc) from exc
        return {"ok": True, "credential": _public_meta(meta)}

    @app.delete("/api/credentials/{name}")
    async def delete_credential(
        name: str,
        x_agx_desktop_token: Optional[str] = Header(default=None),
    ) -> dict:
        check_token(x_agx_desktop_token)
        if not NAME_RE.fullmatch(name or ""):
            raise HTTPException(status_code=400, detail="invalid credential name")
        refs = credential_references().get(name, [])
        try:
            deleted = default_store().delete(name)
        except CredentialError as exc:
            raise _http_credential_error(exc) from exc
        if not deleted:
            raise HTTPException(status_code=404, detail="credential not found")
        return {"ok": True, "referenced_by": refs}
