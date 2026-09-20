"""TypeSafe (Jev) runtime config — not a chat provider.

Key resolution order:
1. typesafe.api_key in ~/.agenticx/config.yaml
2. TYPESAFE_API_KEY
3. ~/.config/typesafe/key
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from agenticx.cli.config_manager import ConfigManager

DEFAULT_TYPESAFE_BASE_URL = "https://api.typesafe.ai"
DEFAULT_TYPESAFE_MODEL = "jev-latest"
DEFAULT_TIMEOUT_SEC = 8.0
DEFAULT_ACT_ABOVE = 0.8
DEFAULT_REVIEW_ABOVE = 0.5


def _typesafe_key_file() -> Path:
    return Path.home() / ".config" / "typesafe" / "key"


def _read_key_file(path: Path) -> str:
    try:
        raw = path.read_text(encoding="utf-8")
    except OSError:
        return ""
    return raw.strip()


def resolve_typesafe_api_key(*, configured: str | None = None) -> str:
    """Resolve the TypeSafe API key. Never treat the key as a tool argument."""
    if configured is None:
        configured = str(ConfigManager.get_value("typesafe.api_key") or "")
    configured = configured.strip()
    if configured:
        return configured
    env_key = str(os.environ.get("TYPESAFE_API_KEY") or "").strip()
    if env_key:
        return env_key
    return _read_key_file(_typesafe_key_file())


def _as_bool(value: Any, default: bool) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _as_float(value: Any, default: float) -> float:
    try:
        if value is None or value == "":
            return default
        return float(value)
    except (TypeError, ValueError):
        return default


@dataclass(frozen=True)
class TypesafeSettings:
    enabled: bool = False
    model: str = DEFAULT_TYPESAFE_MODEL
    timeout_sec: float = DEFAULT_TIMEOUT_SEC
    group_routing: bool = True
    kb_auto: bool = False
    show_decision_card: bool = True
    act_above: float = DEFAULT_ACT_ABOVE
    review_above: float = DEFAULT_REVIEW_ABOVE
    has_key: bool = False
    base_url: str = DEFAULT_TYPESAFE_BASE_URL

    @property
    def ready_for_group_routing(self) -> bool:
        return self.enabled and self.group_routing and self.has_key

    @property
    def ready_for_kb_auto(self) -> bool:
        return self.enabled and self.kb_auto and self.has_key


def load_typesafe_settings() -> TypesafeSettings:
    section = ConfigManager.get_value("typesafe") or {}
    if not isinstance(section, dict):
        section = {}
    api_key = resolve_typesafe_api_key(configured=str(section.get("api_key") or ""))
    model = str(section.get("model") or DEFAULT_TYPESAFE_MODEL).strip() or DEFAULT_TYPESAFE_MODEL
    base_url = str(section.get("base_url") or DEFAULT_TYPESAFE_BASE_URL).strip() or DEFAULT_TYPESAFE_BASE_URL
    return TypesafeSettings(
        enabled=_as_bool(section.get("enabled"), False),
        model=model,
        timeout_sec=_as_float(section.get("timeout_sec"), DEFAULT_TIMEOUT_SEC),
        group_routing=_as_bool(section.get("group_routing"), True),
        kb_auto=_as_bool(section.get("kb_auto"), False),
        show_decision_card=_as_bool(section.get("show_decision_card"), True),
        act_above=_as_float(section.get("act_above"), DEFAULT_ACT_ABOVE),
        review_above=_as_float(section.get("review_above"), DEFAULT_REVIEW_ABOVE),
        has_key=bool(api_key),
        base_url=base_url.rstrip("/"),
    )


def typesafe_settings_public_dict(settings: TypesafeSettings | None = None) -> dict[str, Any]:
    """GET payload — never include the raw key."""
    current = settings or load_typesafe_settings()
    return {
        "enabled": current.enabled,
        "has_key": current.has_key,
        "model": current.model,
        "timeout_sec": current.timeout_sec,
        "group_routing": current.group_routing,
        "kb_auto": current.kb_auto,
        "show_decision_card": current.show_decision_card,
        "act_above": current.act_above,
        "review_above": current.review_above,
    }
