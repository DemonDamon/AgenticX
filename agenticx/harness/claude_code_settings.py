#!/usr/bin/env python3
"""Direct-mode sync between Near providers and Claude Code settings.json.

When the active Near harness is ``claude-code``, selecting a catalog chat /
reasoning model can rewrite only the Anthropic-compatible key fields in
``~/.claude/settings.json`` (token/base URL/model aliases) while preserving
permissions, plugins, hooks, mcpServers, and other unrelated keys — similar
in spirit to a Direct profile apply, not a full settings-manager clone.

Builtin / python-agent paths must never call into this module for writes.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, MutableMapping, Optional, Sequence, Tuple

DEFAULT_CLAUDE_SETTINGS_PATH = Path.home() / ".claude" / "settings.json"

# Env / top-level keys Near may rewrite. Everything else is preserved.
_MODEL_ENV_KEYS: Tuple[str, ...] = (
    "ANTHROPIC_MODEL",
    "ANTHROPIC_DEFAULT_HAIKU_MODEL",
    "ANTHROPIC_DEFAULT_SONNET_MODEL",
    "ANTHROPIC_DEFAULT_OPUS_MODEL",
)


class ClaudeSettingsError(ValueError):
    """Raised when settings.json is missing required structure or is invalid."""


def claude_settings_path(override: Optional[os.PathLike[str] | str] = None) -> Path:
    if override is not None:
        return Path(override).expanduser()
    raw = os.environ.get("AGX_CLAUDE_SETTINGS_PATH", "").strip()
    if raw:
        return Path(raw).expanduser()
    return DEFAULT_CLAUDE_SETTINGS_PATH


def normalize_anthropic_base_url(url: str) -> str:
    """Normalize a Near provider ``base_url`` for ``ANTHROPIC_BASE_URL``.

    Claude Code expects the Anthropic-compatible root without a trailing
    ``/v1`` (the CLI appends its own paths). Trailing slashes are stripped.
    Non-``/v1`` suffixes (e.g. Zhipu ``/api/paas/v4``) are left intact.
    """
    text = str(url or "").strip()
    if not text:
        return ""
    text = text.rstrip("/")
    # Only strip a final /v1 segment (case-insensitive), once.
    lower = text.lower()
    if lower.endswith("/v1"):
        text = text[: -len("/v1")].rstrip("/")
    return text


def _unique_nonempty(values: Iterable[Any]) -> List[str]:
    out: List[str] = []
    seen = set()
    for raw in values:
        text = str(raw or "").strip()
        if not text or text in seen:
            continue
        seen.add(text)
        out.append(text)
    return out


def extract_live_model_ids(doc: Mapping[str, Any] | None) -> List[str]:
    """Opaque model ids currently configured in Claude settings."""
    if not isinstance(doc, Mapping):
        return []
    collected: List[Any] = [doc.get("model")]
    env = doc.get("env")
    if isinstance(env, Mapping):
        for key in _MODEL_ENV_KEYS:
            collected.append(env.get(key))
    return _unique_nonempty(collected)


def load_claude_settings(path: Optional[os.PathLike[str] | str] = None) -> Dict[str, Any]:
    """Load settings.json. Missing file → empty dict. Invalid JSON → error."""
    target = claude_settings_path(path)
    if not target.exists():
        return {}
    try:
        raw = target.read_text(encoding="utf-8")
    except OSError as exc:
        raise ClaudeSettingsError(f"cannot read Claude settings: {exc}") from exc
    text = raw.strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ClaudeSettingsError(
            f"invalid JSON in Claude settings ({target}): {exc}"
        ) from exc
    if not isinstance(data, dict):
        raise ClaudeSettingsError(
            f"Claude settings root must be a JSON object ({target})"
        )
    return data


def read_live_model_ids(path: Optional[os.PathLike[str] | str] = None) -> List[str]:
    """Best-effort live ids; invalid JSON yields [] without raising."""
    try:
        return extract_live_model_ids(load_claude_settings(path))
    except ClaudeSettingsError:
        return []


def merge_provider_into_settings(
    doc: Mapping[str, Any] | None,
    *,
    api_key: Optional[str],
    base_url: Optional[str],
    model_id: str,
) -> Dict[str, Any]:
    """Return a new settings object with provider fields applied.

    Preserves unrelated top-level keys (permissions, plugins, hooks,
    mcpServers, theme, …) and unrelated ``env`` entries.
    """
    model = str(model_id or "").strip()
    if not model:
        raise ClaudeSettingsError("model_id is required")

    out: Dict[str, Any] = dict(doc) if isinstance(doc, Mapping) else {}
    env_raw = out.get("env")
    env: Dict[str, Any] = dict(env_raw) if isinstance(env_raw, Mapping) else {}

    key = str(api_key or "").strip()
    if key:
        has_auth = bool(str(env.get("ANTHROPIC_AUTH_TOKEN") or "").strip())
        has_api = bool(str(env.get("ANTHROPIC_API_KEY") or "").strip())
        if has_auth and has_api:
            env["ANTHROPIC_AUTH_TOKEN"] = key
            env["ANTHROPIC_API_KEY"] = key
        elif has_api and not has_auth:
            env["ANTHROPIC_API_KEY"] = key
        else:
            # Default Direct-style: AUTH_TOKEN (Damon's live file; most BYOS gateways).
            env["ANTHROPIC_AUTH_TOKEN"] = key

    normalized_base = normalize_anthropic_base_url(str(base_url or ""))
    if normalized_base:
        env["ANTHROPIC_BASE_URL"] = normalized_base

    out["model"] = model
    for env_key in _MODEL_ENV_KEYS:
        env[env_key] = model

    out["env"] = env
    return out


def _backup_path(target: Path) -> Path:
    return target.with_name(f"{target.name}.agenticx.bak")


def atomic_write_json(path: Path, doc: Mapping[str, Any]) -> None:
    """Write JSON via temp file + os.replace."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(doc, ensure_ascii=False, indent=2) + "\n"
    fd, tmp_name = tempfile.mkstemp(
        prefix=f".{path.name}.",
        suffix=".tmp",
        dir=str(path.parent),
    )
    tmp_path = Path(tmp_name)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(tmp_path, path)
    except Exception:
        try:
            if tmp_path.exists():
                tmp_path.unlink()
        except OSError:
            pass
        raise


def write_claude_settings(
    doc: Mapping[str, Any],
    path: Optional[os.PathLike[str] | str] = None,
    *,
    backup_on_first_rewrite: bool = True,
) -> Path:
    """Atomically write settings. Optionally keep a one-time ``.agenticx.bak``."""
    target = claude_settings_path(path)
    if backup_on_first_rewrite and target.exists():
        bak = _backup_path(target)
        if not bak.exists():
            try:
                shutil.copy2(target, bak)
            except OSError as exc:
                raise ClaudeSettingsError(
                    f"cannot backup Claude settings: {exc}"
                ) from exc
    atomic_write_json(target, doc)
    return target


def apply_provider_to_claude_settings(
    *,
    api_key: Optional[str],
    base_url: Optional[str],
    model_id: str,
    path: Optional[os.PathLike[str] | str] = None,
) -> Dict[str, Any]:
    """Load → merge → safe write. Invalid existing JSON is not clobbered."""
    target = claude_settings_path(path)
    try:
        current = load_claude_settings(target)
    except ClaudeSettingsError:
        # Do not overwrite a corrupt file.
        raise
    merged = merge_provider_into_settings(
        current,
        api_key=api_key,
        base_url=base_url,
        model_id=model_id,
    )
    write_claude_settings(merged, target)
    return merged



def _lookup_provider_raw(
    providers: Mapping[str, Any], name: str
) -> Optional[Mapping[str, Any]]:
    if name in providers and isinstance(providers.get(name), Mapping):
        return providers[name]  # type: ignore[return-value]
    needle = name.lower()
    for key, value in providers.items():
        if str(key).lower() == needle and isinstance(value, Mapping):
            return value
    return None


def apply_named_provider_to_claude_settings(
    provider_name: str,
    model_id: str,
    *,
    path: Optional[os.PathLike[str] | str] = None,
    providers: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    """Resolve ``provider_name`` from AgenticX config (or ``providers``) and apply."""
    name = str(provider_name or "").strip()
    if not name:
        raise ClaudeSettingsError("provider_name is required")
    model = str(model_id or "").strip()
    if not model:
        raise ClaudeSettingsError("model_id is required")

    if providers is not None:
        raw = _lookup_provider_raw(providers, name)
        if not isinstance(raw, Mapping):
            raise ClaudeSettingsError(f"unknown provider: {name}")
        api_key = raw.get("api_key")
        base_url = raw.get("base_url")
    else:
        from agenticx.cli.config_manager import ConfigManager
        from agenticx.runtime.credential_store import resolve_refs

        cfg = ConfigManager.load()
        raw = _lookup_provider_raw(cfg.providers or {}, name)
        if not isinstance(raw, Mapping):
            raise ClaudeSettingsError(f"unknown provider: {name}")
        api_key = raw.get("api_key")
        base_url = raw.get("base_url")
        if isinstance(api_key, str):
            api_key = resolve_refs(api_key)

    return apply_provider_to_claude_settings(
        api_key=str(api_key or "") or None,
        base_url=str(base_url or "") or None,
        model_id=model,
        path=path,
    )


def maybe_sync_claude_code_settings(
    harness_id: Optional[str],
    provider_name: Optional[str],
    model_id: Optional[str],
    *,
    path: Optional[os.PathLike[str] | str] = None,
) -> Optional[Dict[str, Any]]:
    """No-op unless harness is ``claude-code`` and provider/model are set.

    Builtin / python-agent / other harnesses never rewrite Claude settings.
    Failures are swallowed (logged by caller if desired); returns None on skip/error.
    """
    hid = str(harness_id or "").strip().lower()
    if hid not in {"claude-code", "claude_code"}:
        return None
    provider = str(provider_name or "").strip()
    model = str(model_id or "").strip()
    if not provider or not model:
        return None
    # Live-settings synthetic picker rows must not drive a rewrite.
    if provider.startswith("__claude_live"):
        return None
    try:
        return apply_named_provider_to_claude_settings(
            provider, model, path=path
        )
    except ClaudeSettingsError:
        return None
    except Exception:
        return None


__all__ = [
    "ClaudeSettingsError",
    "DEFAULT_CLAUDE_SETTINGS_PATH",
    "apply_named_provider_to_claude_settings",
    "apply_provider_to_claude_settings",
    "atomic_write_json",
    "claude_settings_path",
    "extract_live_model_ids",
    "load_claude_settings",
    "maybe_sync_claude_code_settings",
    "merge_provider_into_settings",
    "normalize_anthropic_base_url",
    "read_live_model_ids",
    "write_claude_settings",
]
