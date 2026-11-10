#!/usr/bin/env python3
"""Direct-mode sync between Near providers and CodeBuddy models/settings.

When the active Near harness is ``codebuddy``, selecting a catalog model can
rewrite ``~/.codebuddy/models.json`` (custom OpenAI-compatible entries) and
set ``~/.codebuddy/settings.json`` ``model`` to ``custom-local:<id>`` — the
shape CodeBuddy already uses for BYOS gateways (e.g. 彩讯).

Builtin / python-agent paths must never call into this module for writes.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import shutil
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Mapping, MutableMapping, Optional, Tuple

DEFAULT_CODEBUDDY_HOME = Path.home() / ".codebuddy"


class CodeBuddySettingsError(ValueError):
    """Raised when CodeBuddy models/settings cannot be applied safely."""


def codebuddy_home(override: Optional[os.PathLike[str] | str] = None) -> Path:
    if override is not None:
        return Path(override).expanduser()
    raw = os.environ.get("AGX_CODEBUDDY_HOME", "").strip()
    if raw:
        return Path(raw).expanduser()
    return DEFAULT_CODEBUDDY_HOME


def codebuddy_models_path(home: Optional[os.PathLike[str] | str] = None) -> Path:
    return codebuddy_home(home) / "models.json"


def codebuddy_settings_path(home: Optional[os.PathLike[str] | str] = None) -> Path:
    return codebuddy_home(home) / "settings.json"


def custom_local_model_ref(model_id: str) -> str:
    mid = str(model_id or "").strip()
    if not mid:
        raise CodeBuddySettingsError("model_id is required")
    if mid.startswith("custom-local:"):
        return mid
    return f"custom-local:{mid}"


def strip_custom_local_prefix(model_id: str) -> str:
    mid = str(model_id or "").strip()
    if mid.startswith("custom-local:"):
        return mid.split(":", 1)[1].strip()
    return mid


def normalize_codebuddy_chat_url(url: str) -> str:
    """Normalize Near ``base_url`` into a CodeBuddy models.json chat URL."""
    text = str(url or "").strip()
    if not text:
        return ""
    text = text.rstrip("/")
    lower = text.lower()
    if lower.endswith("/chat/completions"):
        return text
    # Near stores OpenAI-compatible roots as .../v1 (sometimes bare host).
    if lower.endswith("/v1") or lower.endswith("/compatible-mode/v1"):
        return text + "/chat/completions"
    # Bare gateway root → assume /v1/chat/completions.
    return text + "/v1/chat/completions"


def _backup_path(target: Path) -> Path:
    return target.with_name(f"{target.name}.agenticx.bak")


def atomic_write_json(path: Path, doc: Mapping[str, Any]) -> None:
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


def load_json_object(path: Path) -> Dict[str, Any]:
    if not path.exists():
        return {}
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError as exc:
        raise CodeBuddySettingsError(f"cannot read {path}: {exc}") from exc
    text = raw.strip()
    if not text:
        return {}
    try:
        data = json.loads(text)
    except json.JSONDecodeError as exc:
        raise CodeBuddySettingsError(f"invalid JSON in {path}: {exc}") from exc
    if not isinstance(data, dict):
        raise CodeBuddySettingsError(f"JSON root must be an object ({path})")
    return data


def write_json_with_backup(
    path: Path,
    doc: Mapping[str, Any],
    *,
    backup_on_first_rewrite: bool = True,
) -> Path:
    if backup_on_first_rewrite and path.exists():
        bak = _backup_path(path)
        if not bak.exists():
            try:
                shutil.copy2(path, bak)
            except OSError as exc:
                raise CodeBuddySettingsError(f"cannot backup {path}: {exc}") from exc
    atomic_write_json(path, doc)
    return path


def merge_provider_into_models_doc(
    doc: Mapping[str, Any] | None,
    *,
    model_id: str,
    api_key: Optional[str],
    base_url: Optional[str],
    display_name: Optional[str] = None,
    vendor: Optional[str] = None,
) -> Dict[str, Any]:
    mid = strip_custom_local_prefix(model_id)
    if not mid:
        raise CodeBuddySettingsError("model_id is required")
    chat_url = normalize_codebuddy_chat_url(str(base_url or ""))
    if not chat_url:
        raise CodeBuddySettingsError(
            "base_url is required to sync a CodeBuddy custom-local model"
        )

    out: Dict[str, Any] = dict(doc) if isinstance(doc, Mapping) else {}
    models_raw = out.get("models")
    models: List[Any] = list(models_raw) if isinstance(models_raw, list) else []

    label = str(display_name or mid).strip() or mid
    vendor_label = str(vendor or "").strip() or label
    entry = {
        "id": mid,
        "name": label,
        "vendor": vendor_label,
        "url": chat_url,
        "apiKey": str(api_key or "").strip(),
        "supportsToolCall": True,
        "supportsImages": False,
        "supportsReasoning": True,
    }

    replaced = False
    new_models: List[Any] = []
    for item in models:
        if isinstance(item, Mapping) and str(item.get("id") or "").strip() == mid:
            merged = dict(item)
            merged.update(entry)
            # Preserve explicit capability flags when already set.
            for flag in ("supportsToolCall", "supportsImages", "supportsReasoning"):
                if flag in item:
                    merged[flag] = item[flag]
            new_models.append(merged)
            replaced = True
        else:
            new_models.append(item)
    if not replaced:
        new_models.append(entry)
    out["models"] = new_models
    return out


def merge_model_into_settings_doc(
    doc: Mapping[str, Any] | None,
    *,
    model_id: str,
) -> Dict[str, Any]:
    out: Dict[str, Any] = dict(doc) if isinstance(doc, Mapping) else {}
    out["model"] = custom_local_model_ref(model_id)
    return out


def apply_provider_to_codebuddy_settings(
    *,
    model_id: str,
    api_key: Optional[str],
    base_url: Optional[str],
    display_name: Optional[str] = None,
    vendor: Optional[str] = None,
    home: Optional[os.PathLike[str] | str] = None,
) -> Dict[str, Any]:
    """Load models.json + settings.json → merge → safe write."""
    home_path = codebuddy_home(home)
    models_path = codebuddy_models_path(home_path)
    settings_path = codebuddy_settings_path(home_path)

    models_doc = load_json_object(models_path)
    settings_doc = load_json_object(settings_path)

    merged_models = merge_provider_into_models_doc(
        models_doc,
        model_id=model_id,
        api_key=api_key,
        base_url=base_url,
        display_name=display_name,
        vendor=vendor,
    )
    merged_settings = merge_model_into_settings_doc(settings_doc, model_id=model_id)

    write_json_with_backup(models_path, merged_models)
    write_json_with_backup(settings_path, merged_settings)
    return {
        "models_path": str(models_path),
        "settings_path": str(settings_path),
        "model": merged_settings.get("model"),
        "models": merged_models.get("models"),
    }


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


def apply_named_provider_to_codebuddy_settings(
    provider_name: str,
    model_id: str,
    *,
    home: Optional[os.PathLike[str] | str] = None,
    providers: Optional[Mapping[str, Any]] = None,
) -> Dict[str, Any]:
    name = str(provider_name or "").strip()
    if not name:
        raise CodeBuddySettingsError("provider_name is required")
    model = strip_custom_local_prefix(model_id)
    if not model:
        raise CodeBuddySettingsError("model_id is required")

    if providers is not None:
        raw = _lookup_provider_raw(providers, name)
        if not isinstance(raw, Mapping):
            raise CodeBuddySettingsError(f"unknown provider: {name}")
        api_key = raw.get("api_key")
        base_url = raw.get("base_url")
        display_name = raw.get("display_name") or name
    else:
        from agenticx.cli.config_manager import ConfigManager
        from agenticx.runtime.credential_store import resolve_refs

        cfg = ConfigManager.load()
        raw = _lookup_provider_raw(cfg.providers or {}, name)
        if not isinstance(raw, Mapping):
            raise CodeBuddySettingsError(f"unknown provider: {name}")
        api_key = raw.get("api_key")
        base_url = raw.get("base_url")
        display_name = raw.get("display_name") or name
        if isinstance(api_key, str):
            api_key = resolve_refs(api_key)

    if not str(base_url or "").strip():
        raise CodeBuddySettingsError(
            f"provider {name!r} has no base_url; CodeBuddy custom-local sync skipped"
        )

    return apply_provider_to_codebuddy_settings(
        model_id=model,
        api_key=str(api_key or "") or None,
        base_url=str(base_url or "") or None,
        display_name=str(display_name or "") or None,
        vendor=str(display_name or name),
        home=home,
    )


def maybe_sync_codebuddy_settings(
    harness_id: Optional[str],
    provider_name: Optional[str],
    model_id: Optional[str],
    *,
    home: Optional[os.PathLike[str] | str] = None,
    providers: Optional[Mapping[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    """No-op unless harness is ``codebuddy`` and provider/model are set."""
    hid = str(harness_id or "").strip().lower()
    if hid not in {"codebuddy", "code-buddy", "code_buddy"}:
        return None
    provider = str(provider_name or "").strip()
    model = str(model_id or "").strip()
    if not provider or not model:
        return None
    if provider.startswith("__"):
        return None
    try:
        return apply_named_provider_to_codebuddy_settings(
            provider, model, home=home, providers=providers
        )
    except CodeBuddySettingsError:
        return None
    except Exception:
        return None


__all__ = [
    "CodeBuddySettingsError",
    "DEFAULT_CODEBUDDY_HOME",
    "apply_named_provider_to_codebuddy_settings",
    "apply_provider_to_codebuddy_settings",
    "codebuddy_home",
    "codebuddy_models_path",
    "codebuddy_settings_path",
    "custom_local_model_ref",
    "maybe_sync_codebuddy_settings",
    "merge_model_into_settings_doc",
    "merge_provider_into_models_doc",
    "normalize_codebuddy_chat_url",
    "strip_custom_local_prefix",
]
