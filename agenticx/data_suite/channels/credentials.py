from __future__ import annotations

from typing import Any, Dict, Optional

from agenticx.cli.config_manager import ConfigManager
from agenticx.data_suite.channels.base import DataChannel
from agenticx.data_suite.channels.clickhouse import ClickHouseChannel
from agenticx.data_suite.channels.fake import FakeChannel
from agenticx.data_suite.channels.grants import WriteGrantStore

_SECRET_KEYS = ("password", "token", "secret", "api_key", "apikey", "access_key")


class ChannelConfigError(LookupError):
    """Raised when a channel config entry is missing or invalid."""


def load_channel_config(name: str) -> Dict[str, Any]:
    """Load ``data_suite.channels.<name>`` from ConfigManager (never logs secrets)."""
    section = ConfigManager.get_value("data_suite")
    if not isinstance(section, dict):
        raise ChannelConfigError(f"missing data_suite config for channel {name!r}")
    channels = section.get("channels")
    if not isinstance(channels, dict):
        raise ChannelConfigError(f"missing data_suite.channels for {name!r}")
    entry = channels.get(name)
    if not isinstance(entry, dict):
        raise ChannelConfigError(f"missing data_suite.channels.{name}")
    return dict(entry)


def _grants_from_cfg(cfg: Dict[str, Any]) -> WriteGrantStore:
    raw = cfg.get("grants")
    if isinstance(raw, dict):
        return WriteGrantStore(grants={str(k): dict(v) for k, v in raw.items() if isinstance(v, dict)})
    return WriteGrantStore()


def build_channel(
    name: str,
    *,
    cfg: Optional[Dict[str, Any]] = None,
    grants: Optional[WriteGrantStore] = None,
) -> DataChannel:
    """Factory: kind clickhouse|fake|jdbc|hive|kafka|file → DataChannel."""
    entry = dict(cfg) if cfg is not None else load_channel_config(name)
    kind = str(entry.get("kind") or entry.get("type") or "fake").strip().lower()
    store = grants if grants is not None else _grants_from_cfg(entry)
    if kind == "clickhouse":
        return ClickHouseChannel.from_dict(name, entry, grants=store)
    # P0: jdbc/hive/kafka/file share FakeChannel with kind tag
    tables = entry.get("tables") if isinstance(entry.get("tables"), dict) else {}
    dialect = str(entry.get("dialect") or kind)
    return FakeChannel(
        name=name,
        tables={str(t): list(rows) if isinstance(rows, list) else [] for t, rows in tables.items()},
        grants=store,
        kind=kind,
        dialect=dialect,
    )


def redact_secrets(cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Return a copy with secret-looking values replaced by *** (for safe logs)."""
    out: Dict[str, Any] = {}
    for k, v in cfg.items():
        key_l = str(k).lower()
        if any(s in key_l for s in _SECRET_KEYS):
            out[k] = "***"
        elif isinstance(v, dict):
            out[k] = redact_secrets(v)
        else:
            out[k] = v
    return out
