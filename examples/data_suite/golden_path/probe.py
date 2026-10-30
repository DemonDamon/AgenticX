"""Stage 1: load seed into channel registry and probe src.

Supports ``kind=fake|file|hive`` so golden-path can demo FileChannel /
HiveChannel (in-memory transports) without a live SFTP/OSS/Hive cluster.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Mapping, Optional, Union

import yaml

from agenticx.data_suite.channels.base import ChannelProbeResult
from agenticx.data_suite.channels.fake import FakeChannel
from agenticx.data_suite.channels.file import FileChannel, InMemoryFileTransport
from agenticx.data_suite.channels.grants import WriteGrantStore
from agenticx.data_suite.channels.hive import HiveChannel, InMemoryHiveTransport
from agenticx.data_suite.channels.registry import ChannelRegistry

ROOT = Path(__file__).resolve().parent
SEED = ROOT / "seed"

VALID_KINDS = frozenset({"fake", "file", "hive"})


def load_member_seed(path: Union[str, Path, None] = None) -> List[Dict[str, Any]]:
    p = Path(path) if path is not None else SEED / "members.json"
    raw = json.loads(p.read_text(encoding="utf-8"))
    if isinstance(raw, list):
        return list(raw)
    members = raw.get("members")
    if not isinstance(members, list):
        raise ValueError(f"seed must be list or {{members: [...]}}: {p}")
    return list(members)


def _channel_names(
    channels_yaml: Union[str, Path, None],
) -> tuple[str, str, str, str, str]:
    """Return (src_name, src_table, dst_name, dst_table, grant_id)."""
    src_name = "src"
    src_table = "members"
    dst_name = "dst"
    dst_table = "members_out"
    grant_id = "g_load"
    cfg_path = Path(channels_yaml) if channels_yaml is not None else SEED / "channels.yaml"
    if cfg_path.is_file():
        loaded = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        cfg: Mapping[str, Any] = loaded.get("channels") or {}
        if isinstance(cfg.get("src"), dict):
            src_name = str(cfg["src"].get("name") or src_name)
            src_table = str(cfg["src"].get("table") or src_table)
        if isinstance(cfg.get("dst"), dict):
            dst_name = str(cfg["dst"].get("name") or dst_name)
            dst_table = str(cfg["dst"].get("table") or dst_table)
            grant_id = str(cfg["dst"].get("grant_id") or grant_id)
    return src_name, src_table, dst_name, dst_table, grant_id


def build_golden_registry(
    *,
    seed_rows: Optional[List[Dict[str, Any]]] = None,
    channels_yaml: Union[str, Path, None] = None,
    kind: str = "fake",
) -> ChannelRegistry:
    """Register src (seeded) and dst (empty + write grant) for ``kind``.

    - ``fake``: FakeChannel (default / CI hermetic mainline)
    - ``file``: FileChannel + InMemoryFileTransport (H1 variant)
    - ``hive``: HiveChannel + InMemoryHiveTransport (H2 Fake Thrift stub)
    """
    k = (kind or "fake").strip().lower()
    if k not in VALID_KINDS:
        raise ValueError(f"unsupported golden-path channel kind: {kind!r} (want {sorted(VALID_KINDS)})")

    rows = list(seed_rows) if seed_rows is not None else load_member_seed()
    src_name, src_table, dst_name, dst_table, grant_id = _channel_names(channels_yaml)
    grants = WriteGrantStore(
        grants={grant_id: {"channel": dst_name, "table": dst_table}}
    )
    registry = ChannelRegistry()

    if k == "fake":
        registry.register(
            FakeChannel(name=src_name, tables={src_table: [dict(r) for r in rows]})
        )
        registry.register(
            FakeChannel(name=dst_name, tables={dst_table: []}, grants=grants)
        )
        return registry

    if k == "file":
        src_transport = InMemoryFileTransport(
            tables={src_table: {"part-0": [dict(r) for r in rows]}}
        )
        dst_transport = InMemoryFileTransport(tables={dst_table: {}})
        registry.register(FileChannel(name=src_name, transport=src_transport))
        registry.register(
            FileChannel(name=dst_name, transport=dst_transport, grants=grants)
        )
        return registry

    # hive
    src_transport_h = InMemoryHiveTransport(
        tables={src_table: [dict(r) for r in rows]}
    )
    dst_transport_h = InMemoryHiveTransport(tables={dst_table: []})
    registry.register(HiveChannel(name=src_name, transport=src_transport_h))
    registry.register(
        HiveChannel(name=dst_name, transport=dst_transport_h, grants=grants)
    )
    return registry


def probe_src(registry: ChannelRegistry) -> ChannelProbeResult:
    return registry.get("src").probe()
