#!/usr/bin/env python3
"""Unified Near → harness native settings sync (cc-switch style).

Dispatches Direct-style provider/model sync to Claude Code, Codex, or
CodeBuddy based on the active harness id. Builtin / python-agent never
rewrites third-party CLI configs.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Optional


def maybe_sync_harness_settings(
    harness_id: Optional[str],
    provider_name: Optional[str],
    model_id: Optional[str],
) -> Optional[Dict[str, Any]]:
    """Sync Near provider+model into the active harness native config.

    Returns the written document/summary dict, or ``None`` when skipped.
    Failures are swallowed (callers treat sync as best-effort).
    """
    hid = str(harness_id or "").strip().lower().replace("_", "-")
    if hid in {"", "python-agent", "builtin", "agenticx"}:
        return None

    if hid in {"claude-code", "claudecode"}:
        from agenticx.harness.claude_code_settings import maybe_sync_claude_code_settings

        return maybe_sync_claude_code_settings(harness_id, provider_name, model_id)

    if hid == "codex":
        from agenticx.harness.codex_settings import maybe_sync_codex_settings

        return maybe_sync_codex_settings(harness_id, provider_name, model_id)

    if hid in {"codebuddy", "code-buddy"}:
        from agenticx.harness.codebuddy_settings import maybe_sync_codebuddy_settings

        return maybe_sync_codebuddy_settings(harness_id, provider_name, model_id)

    return None


def apply_harness_settings(
    harness_id: str,
    provider_name: str,
    model_id: str,
) -> Dict[str, Any]:
    """Explicit apply used by desktop ``/api/harness/settings/apply``.

    Raises ValueError subclasses from the underlying sync helpers.
    """
    hid = str(harness_id or "").strip().lower().replace("_", "-")
    provider = str(provider_name or "").strip()
    model = str(model_id or "").strip()
    if not hid:
        raise ValueError("harness_id is required")
    if not provider or not model:
        raise ValueError("provider and model are required")

    if hid in {"claude-code", "claudecode"}:
        from agenticx.harness.claude_code_settings import (
            ClaudeSettingsError,
            apply_named_provider_to_claude_settings,
            claude_settings_path,
            extract_live_model_ids,
        )

        if provider.startswith("__claude_live"):
            return {
                "ok": True,
                "skipped": True,
                "reason": "live_settings_alias",
                "harness_id": "claude-code",
                "path": str(claude_settings_path()),
                "models": [],
            }
        try:
            doc = apply_named_provider_to_claude_settings(provider, model)
        except ClaudeSettingsError:
            raise
        return {
            "ok": True,
            "skipped": False,
            "harness_id": "claude-code",
            "path": str(claude_settings_path()),
            "model": doc.get("model"),
            "models": extract_live_model_ids(doc),
            "base_url": (doc.get("env") or {}).get("ANTHROPIC_BASE_URL")
            if isinstance(doc.get("env"), dict)
            else None,
        }

    if hid == "codex":
        from agenticx.harness.codex_settings import (
            CodexSettingsError,
            apply_named_provider_to_codex_settings,
            codex_config_path,
            sanitize_codex_provider_id,
        )

        try:
            doc = apply_named_provider_to_codex_settings(provider, model)
        except CodexSettingsError:
            raise
        return {
            "ok": True,
            "skipped": False,
            "harness_id": "codex",
            "path": str(codex_config_path()),
            "model": doc.get("model"),
            "model_provider": doc.get("model_provider"),
            "managed_provider_id": sanitize_codex_provider_id(provider),
            "wire_api": "responses",
            "caveat": (
                "Codex custom providers speak the Responses API only; "
                "Chat Completions-only gateways may still fail until they "
                "expose /v1/responses."
            ),
        }

    if hid in {"codebuddy", "code-buddy"}:
        from agenticx.harness.codebuddy_settings import (
            CodeBuddySettingsError,
            apply_named_provider_to_codebuddy_settings,
            codebuddy_home,
        )

        try:
            doc = apply_named_provider_to_codebuddy_settings(provider, model)
        except CodeBuddySettingsError:
            raise
        return {
            "ok": True,
            "skipped": False,
            "harness_id": "codebuddy",
            "home": str(codebuddy_home()),
            "model": doc.get("model"),
            "models_path": doc.get("models_path"),
            "settings_path": doc.get("settings_path"),
        }

    raise ValueError(f"harness {hid!r} does not support Near settings sync")


__all__ = [
    "apply_harness_settings",
    "maybe_sync_harness_settings",
]
