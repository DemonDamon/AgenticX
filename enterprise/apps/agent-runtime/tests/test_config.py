#!/usr/bin/env python3
"""Settings fail closed and secret environment variables are scrubbed.

Author: Damon Li
"""

from __future__ import annotations

from pathlib import Path

import pytest

from ma_agent_runtime.config import Settings, scrub_secret_env


def _env(tmp_path: Path, **overrides: str) -> dict[str, str]:
    home = str(tmp_path / "home")
    base = {
        "DATABASE_URL": "postgresql://u:p@127.0.0.1:5432/db",
        "MA_INTERNAL_TOKEN": "internal",
        "MA_RUNTIME_GATEWAY_TOKEN": "agx-pat-gateway",
        "MA_RUNTIME_HOME": home,
        "HOME": home,
    }
    base.update(overrides)
    return base


def test_from_env_requires_secrets(tmp_path: Path) -> None:
    missing_internal = _env(tmp_path)
    del missing_internal["MA_INTERNAL_TOKEN"]
    with pytest.raises(RuntimeError, match=r"^MA_INTERNAL_TOKEN:"):
        Settings.from_env(missing_internal)

    missing_gateway = _env(tmp_path)
    del missing_gateway["MA_RUNTIME_GATEWAY_TOKEN"]
    with pytest.raises(RuntimeError, match=r"^MA_RUNTIME_GATEWAY_TOKEN:"):
        Settings.from_env(missing_gateway)

    bad_token = _env(tmp_path, MA_RUNTIME_GATEWAY_TOKEN="not-a-pat") # gitleaks:allow
    with pytest.raises(RuntimeError, match=r"^MA_RUNTIME_GATEWAY_TOKEN:"):
        Settings.from_env(bad_token)

    missing_home = _env(tmp_path)
    del missing_home["MA_RUNTIME_HOME"]
    with pytest.raises(RuntimeError, match=r"^MA_RUNTIME_HOME:"):
        Settings.from_env(missing_home)


def test_from_env_reads_file_variants(tmp_path: Path) -> None:
    secret = tmp_path / "internal.txt"
    secret.write_text("  from-file\n", encoding="utf-8")
    env = _env(tmp_path)
    del env["MA_INTERNAL_TOKEN"]
    env["MA_INTERNAL_TOKEN_FILE"] = str(secret)
    settings = Settings.from_env(env)
    assert settings.internal_token == "from-file"


def test_rejects_mysql(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match="PostgreSQL only"):
        Settings.from_env(_env(tmp_path, DATABASE_URL="mysql://u:p@127.0.0.1:3306/db"))
    with pytest.raises(RuntimeError, match="PostgreSQL only"):
        Settings.from_env(_env(tmp_path, DATABASE_DIALECT="mysql"))


def test_gateway_url_must_end_with_v1(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match=r"^MA_RUNTIME_GATEWAY_URL:"):
        Settings.from_env(_env(tmp_path, MA_RUNTIME_GATEWAY_URL="http://127.0.0.1:8088"))
    settings = Settings.from_env(_env(tmp_path, MA_RUNTIME_GATEWAY_URL="http://127.0.0.1:8088/v1/"))
    assert settings.gateway_url == "http://127.0.0.1:8088/v1"


def test_command_sandbox_values(tmp_path: Path) -> None:
    with pytest.raises(RuntimeError, match=r"^MA_RUNTIME_COMMAND_SANDBOX:"):
        Settings.from_env(_env(tmp_path, MA_RUNTIME_COMMAND_SANDBOX="foo"))
    settings = Settings.from_env(_env(tmp_path))
    assert settings.command_sandbox == "required"


def test_task_settings_defaults_and_bounds(tmp_path: Path) -> None:
    settings = Settings.from_env(_env(tmp_path))
    assert settings.tasks_enabled is False
    assert settings.task_foreground_seconds == 60
    assert settings.task_max_runtime_seconds == 3600
    assert settings.max_running_tasks == 8

    still_off = Settings.from_env(_env(tmp_path, MA_RUNTIME_TASKS_ENABLED="true"))
    assert still_off.tasks_enabled is False

    enabled = Settings.from_env(_env(tmp_path, MA_RUNTIME_TASKS_ENABLED="1"))
    assert enabled.tasks_enabled is True
    assert settings.threads_enabled is False
    threaded = Settings.from_env(_env(tmp_path, MA_RUNTIME_THREADS_ENABLED="1"))
    assert threaded.threads_enabled is True
    still_threads_off = Settings.from_env(_env(tmp_path, MA_RUNTIME_THREADS_ENABLED="true"))
    assert still_threads_off.threads_enabled is False

    with pytest.raises(ValueError, match=r"^MA_RUNTIME_MAX_RUNNING_TASKS:"):
        Settings.from_env(_env(tmp_path, MA_RUNTIME_MAX_RUNNING_TASKS="0"))


def test_eval_settings_defaults(tmp_path: Path) -> None:
    settings = Settings.from_env(_env(tmp_path))
    assert settings.evals_enabled is False
    assert settings.eval_item_timeout_seconds == 600
    assert settings.eval_max_concurrent_runs == 1
    enabled = Settings.from_env(
        _env(
            tmp_path,
            MA_RUNTIME_EVALS_ENABLED="1",
            MA_EVAL_ITEM_TIMEOUT_SECONDS="30",
            MA_EVAL_MAX_CONCURRENT_RUNS="4",
        )
    )
    assert enabled.evals_enabled is True
    assert enabled.eval_item_timeout_seconds == 30
    assert enabled.eval_max_concurrent_runs == 4
    still_off = Settings.from_env(_env(tmp_path, MA_RUNTIME_EVALS_ENABLED="true"))
    assert still_off.evals_enabled is False


def test_dream_settings_defaults(tmp_path: Path) -> None:
    settings = Settings.from_env(_env(tmp_path))
    assert settings.dreams_enabled is False
    assert settings.dream_timeout_seconds == 7200
    assert settings.dream_max_concurrent == 1
    enabled = Settings.from_env(
        _env(
            tmp_path,
            MA_RUNTIME_DREAMS_ENABLED="1",
            MA_DREAM_TIMEOUT_SECONDS="300",
            MA_DREAM_MAX_CONCURRENT="4",
        )
    )
    assert enabled.dreams_enabled is True
    assert enabled.dream_timeout_seconds == 300
    assert enabled.dream_max_concurrent == 4
    still_off = Settings.from_env(_env(tmp_path, MA_RUNTIME_DREAMS_ENABLED="true"))
    assert still_off.dreams_enabled is False
    with pytest.raises(ValueError, match=r"^MA_DREAM_TIMEOUT_SECONDS:"):
        Settings.from_env(_env(tmp_path, MA_DREAM_TIMEOUT_SECONDS="299"))
    with pytest.raises(ValueError, match=r"^MA_DREAM_MAX_CONCURRENT:"):
        Settings.from_env(_env(tmp_path, MA_DREAM_MAX_CONCURRENT="5"))


def test_scrub_secret_env() -> None:
    env = {
        "DATABASE_URL": "x",
        "MA_INTERNAL_TOKEN": "x",
        "MA_INTERNAL_TOKEN_FILE": "x",
        "AUTH_JWT_PRIVATE_KEY": "x",
        "ADMIN_CONSOLE_LOGIN_PASSWORD": "x",
        "OPENAI_API_KEY": "x",
        "SSO_STATE_SIGNING_SECRET": "x",
        "PATH": "/bin",
        "HOME": "/h",
        "MA_RUNTIME_HOME": "/h",
    }
    removed = scrub_secret_env(env)
    assert removed == [
        "ADMIN_CONSOLE_LOGIN_PASSWORD",
        "AUTH_JWT_PRIVATE_KEY",
        "DATABASE_URL",
        "MA_INTERNAL_TOKEN",
        "MA_INTERNAL_TOKEN_FILE",
        "OPENAI_API_KEY",
        "SSO_STATE_SIGNING_SECRET",
    ]
    assert env == {"PATH": "/bin", "HOME": "/h", "MA_RUNTIME_HOME": "/h"}
