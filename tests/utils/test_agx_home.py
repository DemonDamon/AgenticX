"""Unit tests for configurable AgenticX data root resolution."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.utils import agx_home as agx_home_mod


@pytest.fixture(autouse=True)
def _clear_agx_home_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("AGX_HOME", raising=False)
    monkeypatch.delenv("AGENTICX_HOME", raising=False)


def test_default_when_unset(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("USERPROFILE", str(tmp_path))
    assert agx_home_mod.agx_home() == tmp_path / ".agenticx"


def test_env_agx_home_wins(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    custom = tmp_path / "custom-data"
    custom.mkdir()
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("AGX_HOME", str(custom))
    assert agx_home_mod.agx_home() == custom.resolve()


def test_env_agenticx_home_alias(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    custom = tmp_path / "from-agenticx-home"
    custom.mkdir()
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("AGENTICX_HOME", str(custom))
    assert agx_home_mod.agx_home() == custom.resolve()


def test_env_overrides_pointer(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    env_dir = tmp_path / "env-root"
    pointer_dir = tmp_path / "pointer-root"
    env_dir.mkdir()
    pointer_dir.mkdir()
    monkeypatch.setenv("HOME", str(tmp_path))
    monkeypatch.setenv("AGX_HOME", str(env_dir))
    agx_home_mod.write_data_root_pointer(pointer_dir)
    assert agx_home_mod.agx_home() == env_dir.resolve()


def test_pointer_second_priority(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    pointer_dir = tmp_path / "pointer-root"
    pointer_dir.mkdir()
    monkeypatch.setenv("HOME", str(tmp_path))
    agx_home_mod.write_data_root_pointer(pointer_dir)
    assert agx_home_mod.agx_home() == pointer_dir.resolve()


def test_bootstrap_yaml_near_data_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    yaml_dir = tmp_path / "yaml-root"
    yaml_dir.mkdir()
    stub = tmp_path / ".agenticx"
    stub.mkdir()
    (stub / "config.yaml").write_text(f'near:\n  data_dir: "{yaml_dir}"\n', encoding="utf-8")
    monkeypatch.setenv("HOME", str(tmp_path))
    assert agx_home_mod.agx_home() == yaml_dir.resolve()


def test_write_and_clear_pointer(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    target = tmp_path / "persisted"
    target.mkdir()
    monkeypatch.setenv("HOME", str(tmp_path))
    agx_home_mod.write_data_root_pointer(target)
    pointer = tmp_path / ".agenticx" / "data_root.json"
    assert pointer.is_file()
    payload = json.loads(pointer.read_text(encoding="utf-8"))
    assert payload["data_dir"] == str(target.resolve())
    agx_home_mod.clear_data_root_pointer()
    assert not pointer.exists()
    assert agx_home_mod.agx_home() == tmp_path / ".agenticx"
