#!/usr/bin/env python3
"""Tests for the ``robot:`` config section.

Author: Hongyi Zhao
"""

from __future__ import annotations

from pathlib import Path

import yaml

from agenticx.cli.config_manager import (
    ConfigManager,
    RobotSettings,
    _robot_settings_from_raw,
)


def _isolate(tmp_path: Path, monkeypatch) -> Path:
    monkeypatch.chdir(tmp_path)
    global_path = tmp_path / "global.yaml"
    monkeypatch.setattr(ConfigManager, "GLOBAL_CONFIG_PATH", global_path)
    monkeypatch.setattr(
        ConfigManager, "PROJECT_CONFIG_PATH", tmp_path / ".agenticx" / "config.yaml"
    )
    return global_path


def test_defaults_are_off():
    settings = _robot_settings_from_raw({})
    assert settings == RobotSettings()
    assert settings.enabled is False
    assert settings.default_max_relative_target == 10.0
    assert settings.confirm_each_task is True and settings.offline_backbone is True


def test_profiles_and_nullable_motion_limit():
    settings = _robot_settings_from_raw(
        {
            "enabled": True,
            "default_max_relative_target": None,
            "profiles": {"a": {"type": "so101_follower"}, "b": {"port": "x"}, "c": 3},
        }
    )
    assert settings.enabled is True
    assert settings.default_max_relative_target is None
    assert list(settings.profiles) == ["a"]


def test_bad_values_fall_back_to_defaults():
    settings = _robot_settings_from_raw(
        {
            "load_timeout_s": "slow",
            "stop_timeout_s": None,
            "default_max_relative_target": "x",
            "profiles": "nope",
        }
    )
    assert settings.load_timeout_s == 300.0
    assert settings.stop_timeout_s == 30.0
    assert settings.default_max_relative_target == 10.0
    assert settings.profiles == {}


def test_config_manager_loads_robot_section(tmp_path: Path, monkeypatch):
    global_path = _isolate(tmp_path, monkeypatch)
    global_path.write_text(
        yaml.safe_dump(
            {
                "robot": {
                    "enabled": True,
                    "bridge_url": "http://127.0.0.1:9000",
                    "profiles": {"desk": {"type": "t"}},
                }
            }
        ),
        encoding="utf-8",
    )
    robot = ConfigManager.load().robot
    assert robot.enabled is True
    assert robot.bridge_url == "http://127.0.0.1:9000"
    assert robot.profiles == {"desk": {"type": "t"}}


def test_missing_section_means_disabled(tmp_path: Path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    assert ConfigManager.load().robot == RobotSettings()


def test_masked_config_masks_robot_token(tmp_path: Path, monkeypatch):
    _isolate(tmp_path, monkeypatch)
    ConfigManager.set_value("robot.token", "tok-abcdefgh12345678", scope="global")
    masked = ConfigManager.masked_config()
    assert "12345678" not in masked["robot"]["token"]
    assert "abcdefgh" not in masked["robot"]["token"]
