#!/usr/bin/env python3
"""Tests for atomic config.yaml writes.

Author: Damon Li
"""

import os
import stat

import pytest

from agenticx.cli.config_manager import ConfigManager


def test_dump_creates_bak_of_previous(tmp_path):
    path = tmp_path / "config.yaml"
    ConfigManager._dump_yaml(path, {"a": 1})
    first = path.read_bytes()
    ConfigManager._dump_yaml(path, {"a": 2})
    assert (tmp_path / "config.yaml.bak").read_bytes() == first
    assert "a: 2" in path.read_text(encoding="utf-8")


def test_failed_serialize_keeps_original(tmp_path):
    path = tmp_path / "config.yaml"
    ConfigManager._dump_yaml(path, {"a": 1})
    before = path.read_bytes()
    with pytest.raises(Exception):
        ConfigManager._dump_yaml(path, {"a": object()})
    assert path.read_bytes() == before
    assert not [p for p in tmp_path.iterdir() if ".tmp." in p.name]


def test_replace_failure_cleans_tmp(tmp_path, monkeypatch):
    path = tmp_path / "config.yaml"
    ConfigManager._dump_yaml(path, {"a": 1})
    before = path.read_bytes()

    def boom(*args, **kwargs):
        raise OSError("replace failed")

    monkeypatch.setattr(os, "replace", boom)
    with pytest.raises(OSError):
        ConfigManager._dump_yaml(path, {"a": 2})
    assert path.read_bytes() == before
    assert not [p for p in tmp_path.iterdir() if ".tmp." in p.name]


def test_mode_preserved(tmp_path):
    path = tmp_path / "config.yaml"
    path.write_text("a: 1\n", encoding="utf-8")
    os.chmod(path, 0o600)
    ConfigManager._dump_yaml(path, {"a": 2})
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
