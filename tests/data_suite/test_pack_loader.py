"""TDD: delivery pack loader."""
from __future__ import annotations

from pathlib import Path

import pytest

from agenticx.data_suite.pack import PackError, load_pack

FIXTURES = Path(__file__).parent / "fixtures"


def test_load_pack_missing_manifest(tmp_path: Path) -> None:
    with pytest.raises(PackError):
        load_pack(tmp_path)


def test_load_pack_mini_fixture() -> None:
    pack = load_pack(FIXTURES / "mini_pack")
    assert pack.manifest.id == "mini-demo"
    assert pack.manifest.version == "0.1.0"
    assert pack.manifest.display_name == "Mini Demo Pack"
    assert pack.sections.get("channels") in (None, {}, [])
    # absent section dirs → empty / missing key ok
    assert "channels" not in pack.sections or pack.sections["channels"] in ({}, [])


def test_load_pack_with_section_yaml(tmp_path: Path) -> None:
    (tmp_path / "pack.yaml").write_text(
        "id: s\nversion: 1.0.0\ndisplay_name: S\nchannels: channels\n"
    )
    ch = tmp_path / "channels"
    ch.mkdir()
    (ch / "channels.yaml").write_text("channels:\n  - id: src\n    type: fake\n")
    pack = load_pack(tmp_path)
    assert "channels" in pack.sections
    payload = pack.sections["channels"]
    assert isinstance(payload, dict)
    assert payload["channels"][0]["id"] == "src"
