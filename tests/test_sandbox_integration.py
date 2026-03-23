#!/usr/bin/env python3
"""Integration-style tests for Sandbox factory / backend selection.

Author: Damon Li
"""

from types import SimpleNamespace

from agenticx.sandbox.base import Sandbox


def test_select_backend_prefers_remote_when_available(monkeypatch):
    monkeypatch.setattr(Sandbox, "_is_remote_available", classmethod(lambda cls: True))
    monkeypatch.setattr(
        Sandbox, "_is_microsandbox_available", classmethod(lambda cls: True)
    )
    monkeypatch.setattr(Sandbox, "_is_docker_available", classmethod(lambda cls: True))
    assert Sandbox._select_backend() == "remote"


def test_select_backend_fallback_subprocess(monkeypatch):
    monkeypatch.setattr(Sandbox, "_is_remote_available", classmethod(lambda cls: False))
    monkeypatch.setattr(
        Sandbox, "_is_microsandbox_available", classmethod(lambda cls: False)
    )
    monkeypatch.setattr(Sandbox, "_is_docker_available", classmethod(lambda cls: False))
    assert Sandbox._select_backend() == "subprocess"


def test_select_backend_mode_local(monkeypatch):
    fake_cfg = SimpleNamespace(
        sandbox=SimpleNamespace(mode="local", remote_url=""),
    )
    monkeypatch.setattr(
        "agenticx.cli.config_manager.ConfigManager.load",
        lambda: fake_cfg,
    )
    assert Sandbox._select_backend() == "subprocess"


def test_select_backend_mode_docker_prefers_docker(monkeypatch):
    fake_cfg = SimpleNamespace(
        sandbox=SimpleNamespace(mode="docker", remote_url=""),
    )
    monkeypatch.setattr(
        "agenticx.cli.config_manager.ConfigManager.load",
        lambda: fake_cfg,
    )
    monkeypatch.setattr(Sandbox, "_is_docker_available", classmethod(lambda cls: True))
    assert Sandbox._select_backend() == "docker"


def test_select_backend_mode_docker_falls_back_subprocess(monkeypatch):
    fake_cfg = SimpleNamespace(
        sandbox=SimpleNamespace(mode="docker", remote_url=""),
    )
    monkeypatch.setattr(
        "agenticx.cli.config_manager.ConfigManager.load",
        lambda: fake_cfg,
    )
    monkeypatch.setattr(Sandbox, "_is_docker_available", classmethod(lambda cls: False))
    assert Sandbox._select_backend() == "subprocess"


def test_select_backend_mode_remote_prefers_remote(monkeypatch):
    fake_cfg = SimpleNamespace(
        sandbox=SimpleNamespace(mode="remote", remote_url="http://x.test"),
    )
    monkeypatch.setattr(
        "agenticx.cli.config_manager.ConfigManager.load",
        lambda: fake_cfg,
    )
    monkeypatch.setattr(Sandbox, "_is_remote_available", classmethod(lambda cls: True))
    assert Sandbox._select_backend() == "remote"


def test_select_backend_mode_remote_fallback_docker(monkeypatch):
    fake_cfg = SimpleNamespace(
        sandbox=SimpleNamespace(mode="k8s", remote_url="http://x.test"),
    )
    monkeypatch.setattr(
        "agenticx.cli.config_manager.ConfigManager.load",
        lambda: fake_cfg,
    )
    monkeypatch.setattr(Sandbox, "_is_remote_available", classmethod(lambda cls: False))
    monkeypatch.setattr(Sandbox, "_is_docker_available", classmethod(lambda cls: True))
    assert Sandbox._select_backend() == "docker"
