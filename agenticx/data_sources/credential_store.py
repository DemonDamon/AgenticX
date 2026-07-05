#!/usr/bin/env python3
"""Read data source plugin config and credentials from ~/.agenticx/config.yaml.

Author: Damon Li
"""

from __future__ import annotations

from typing import Any, Dict, Iterable, Optional

from agenticx.cli.config_manager import ConfigManager


def get_data_sources_section() -> Dict[str, Any]:
    """Return the raw ``data_sources`` mapping from merged global+project config."""
    section = ConfigManager.get_value("data_sources")
    return section if isinstance(section, dict) else {}


def get_plugin_config(data_source_name: str) -> Dict[str, Any]:
    """Return one plugin's config entry (may be empty)."""
    section = get_data_sources_section()
    entry = section.get(data_source_name)
    return entry if isinstance(entry, dict) else {}


def is_plugin_enabled(data_source_name: str) -> bool:
    """True when ``data_sources.<name>.enabled`` is explicitly true."""
    entry = get_plugin_config(data_source_name)
    if not entry:
        return False
    return bool(entry.get("enabled", False))


def get_credentials(data_source_name: str) -> Dict[str, Any]:
    """Return credential fields for a plugin (never logs values)."""
    entry = get_plugin_config(data_source_name)
    creds = entry.get("credentials")
    return creds if isinstance(creds, dict) else {}


def has_required_credentials(
    data_source_name: str,
    required_keys: Optional[Iterable[str]] = None,
) -> bool:
    """Check whether configured credentials satisfy required key names."""
    creds = get_credentials(data_source_name)
    if not required_keys:
        return bool(creds)
    for key in required_keys:
        value = creds.get(key)
        if value is None or (isinstance(value, str) and not value.strip()):
            return False
    return True
