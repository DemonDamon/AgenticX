#!/usr/bin/env python3
"""CLI model rewrite for custom models.json entries.

A catalog id that also exists as a custom endpoint (url + apiKey) must be
passed as ``custom-local:<id>``. Bare ids stay bare when no such entry exists.
These tests never embed a real API key.
"""

from __future__ import annotations

import io
import json
from pathlib import Path

import pytest

from agenticx.wb_bridge.custom_model import resolve_codebuddy_cli_model
from agenticx.wb_bridge.session_manager import WbBridgeSessionManager


def _write_models(path: Path, models: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"models": models}), encoding="utf-8")


def test_rewrites_matching_id_with_url_and_api_key(tmp_path: Path) -> None:
    models = tmp_path / ".codebuddy" / "models.json"
    _write_models(
        models,
        [
            {
                "id": "glm-5.3-flash",
                "url": "https://example.invalid/v1/chat/completions",
                "apiKey": "test-key-not-real",
            }
        ],
    )
    resolved = resolve_codebuddy_cli_model("glm-5.3-flash", config_paths=[models])
    assert resolved == "custom-local:glm-5.3-flash"
    assert "test-key-not-real" not in (resolved or "")


def test_workbuddy_home_matches_when_codebuddy_file_absent(tmp_path: Path) -> None:
    missing = tmp_path / ".codebuddy" / "models.json"
    workbuddy = tmp_path / ".workbuddy" / "models.json"
    _write_models(
        workbuddy,
        [
            {
                "id": "glm-5.3-flash",
                "url": "https://example.invalid/aibox/chat/completions",
                "apiKey": "test-key-not-real",
            }
        ],
    )
    assert (
        resolve_codebuddy_cli_model(
            "glm-5.3-flash",
            config_paths=[missing, workbuddy],
        )
        == "custom-local:glm-5.3-flash"
    )


def test_noop_when_no_matching_custom_entry(tmp_path: Path) -> None:
    models = tmp_path / ".codebuddy" / "models.json"
    _write_models(
        models,
        [
            {
                "id": "other-model",
                "url": "https://example.invalid/v1/chat/completions",
                "apiKey": "test-key-not-real",
            }
        ],
    )
    assert resolve_codebuddy_cli_model("glm-5.3-flash", config_paths=[models]) == "glm-5.3-flash"
    assert resolve_codebuddy_cli_model("glm-5.3-flash", config_paths=[]) == "glm-5.3-flash"


def test_noop_when_url_or_api_key_missing(tmp_path: Path) -> None:
    models = tmp_path / ".codebuddy" / "models.json"
    _write_models(
        models,
        [
            {"id": "glm-5.3-flash", "url": "https://example.invalid/v1/chat/completions"},
            {"id": "glm-5.3-flash", "apiKey": "test-key-not-real"},
            {"id": "glm-5.3-flash", "url": "  ", "apiKey": "  "},
        ],
    )
    assert resolve_codebuddy_cli_model("glm-5.3-flash", config_paths=[models]) == "glm-5.3-flash"


def test_keeps_existing_custom_local_prefix(tmp_path: Path) -> None:
    models = tmp_path / ".codebuddy" / "models.json"
    _write_models(
        models,
        [
            {
                "id": "glm-5.3-flash",
                "url": "https://example.invalid/v1/chat/completions",
                "apiKey": "test-key-not-real",
            }
        ],
    )
    already = "custom-local:glm-5.3-flash"
    assert resolve_codebuddy_cli_model(already, config_paths=[models]) == already


def test_malformed_file_is_ignored(tmp_path: Path) -> None:
    broken = tmp_path / ".codebuddy" / "models.json"
    broken.parent.mkdir(parents=True)
    broken.write_text("{not json", encoding="utf-8")
    assert resolve_codebuddy_cli_model("glm-5.3-flash", config_paths=[broken]) == "glm-5.3-flash"


def test_spawn_argv_uses_custom_local_prefix(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    models = tmp_path / "models.json"
    _write_models(
        models,
        [
            {
                "id": "glm-5.3-flash",
                "url": "https://example.invalid/v1/chat/completions",
                "apiKey": "test-key-not-real",
            }
        ],
    )
    captured: dict[str, list[str]] = {}

    class _Proc:
        def __init__(self) -> None:
            self.pid = 7
            self.stdin = io.StringIO()
            self.stdout = io.StringIO()
            self.stderr = io.StringIO()

        def poll(self):
            return None

        def wait(self, timeout=None):
            return 0

        def terminate(self) -> None:
            return None

    def fake_popen(args, **kwargs):
        captured["args"] = list(args)
        return _Proc()

    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.resolve_codebuddy_executable",
        lambda: "/tmp/fake-cb",
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.subprocess.Popen",
        fake_popen,
    )
    monkeypatch.setattr(
        "agenticx.wb_bridge.session_manager.codebuddy_model_config_paths",
        lambda: [models],
    )
    monkeypatch.setenv("WB_BRIDGE_LOG_DIR", str(tmp_path / "logs"))

    mgr = WbBridgeSessionManager()
    session = mgr.start_session(str(tmp_path / "cwd"), model="glm-5.3-flash")
    argv = captured["args"]
    assert argv[argv.index("--model") + 1] == "custom-local:glm-5.3-flash"
    # Picker id stays bare so a live session is not treated as a model mismatch.
    assert session.model == "glm-5.3-flash"
    mgr.stop_session(session.session_id)
