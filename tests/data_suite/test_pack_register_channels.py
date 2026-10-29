"""Register delivery pack channels + idmapping."""
from __future__ import annotations

from pathlib import Path

from agenticx.data_suite.channels.registry import ChannelRegistry
from agenticx.data_suite.pack import load_pack, register_pack

PACK = Path(__file__).resolve().parents[2] / "examples" / "data_suite" / "delivery_pack"


def test_register_pack_channels_and_idmap(tmp_path: Path) -> None:
    pack = load_pack(PACK)
    registry = ChannelRegistry()
    report = register_pack(pack, registry=registry, dictionary_store=__import__("agenticx.data_suite.store.file_store", fromlist=["DictionaryFileStore"]).DictionaryFileStore(root=tmp_path))
    assert "src" in report.channels and "dst" in report.channels
    probe = registry.get("src").probe()
    assert probe.ok
    assert "members" in probe.tables
    assert report.idmapping_profile == "brand_a_default"
