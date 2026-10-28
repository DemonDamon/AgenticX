"""Stage 1: load seed into FakeChannel registry and probe src."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Union

import yaml

from agenticx.data_suite.channels.base import ChannelProbeResult
from agenticx.data_suite.channels.fake import FakeChannel
from agenticx.data_suite.channels.grants import WriteGrantStore
from agenticx.data_suite.channels.registry import ChannelRegistry

ROOT = Path(__file__).resolve().parent
SEED = ROOT / "seed"


def load_member_seed(path: Union[str, Path, None] = None) -> List[Dict[str, Any]]:
    p = Path(path) if path is not None else SEED / "members.json"
    raw = json.loads(p.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return list(raw)
    members = raw.get("members")
    if not isinstance(members, list):
        raise ValueError(f"seed must be list or {{members: [...]}}: {p}")
    return list(members)


def build_golden_registry(
    *,
    seed_rows: Optional[List[Dict[str, Any]]] = None,
    channels_yaml: Union[str, Path, None] = None,
) -> ChannelRegistry:
    """Register FakeChannel src (seeded) and dst (empty + write grant)."""
    rows = list(seed_rows) if seed_rows is not None else load_member_seed()
    cfg_path = Path(channels_yaml) if channels_yaml is not None else SEED / "channels.yaml"
    cfg: Mapping[str, Any] = {}
    if cfg_path.is_file():
        loaded = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        cfg = loaded.get("channels") or {}

    src_name = "src"
    src_table = "members"
    dst_name = "dst"
    dst_table = "members_out"
    grant_id = "g_load"
    if isinstance(cfg.get("src"), dict):
        src_name = str(cfg["src"].get("name") or src_name)
        src_table = str(cfg["src"].get("table") or src_table)
    if isinstance(cfg.get("dst"), dict):
        dst_name = str(cfg["dst"].get("name") or dst_name)
        dst_table = str(cfg["dst"].get("table") or dst_table)
        grant_id = str(cfg["dst"].get("grant_id") or grant_id)

    grants = WriteGrantStore(
        grants={grant_id: {"channel": dst_name, "table": dst_table}}
    )
    registry = ChannelRegistry()
    registry.register(
        FakeChannel(name=src_name, tables={src_table: [dict(r) for r in rows]})
    )
    registry.register(
        FakeChannel(name=dst_name, tables={dst_table: []}, grants=grants)
    )
    return registry


def probe_src(registry: ChannelRegistry) -> ChannelProbeResult:
    return registry.get("src").probe()
