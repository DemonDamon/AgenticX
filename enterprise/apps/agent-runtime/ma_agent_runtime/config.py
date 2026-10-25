#!/usr/bin/env python3
"""Environment configuration for the managed agent runtime.

Author: Damon Li
"""

from __future__ import annotations

import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Mapping, MutableMapping
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

DEFAULT_ADMIN_URL = "http://127.0.0.1:3001"
DEFAULT_GATEWAY_URL = "http://127.0.0.1:8088/v1"
SECRET_ENV_RE = re.compile(
    r"^(?:.*_)?(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY|DATABASE_URL)(?:_FILE)?$"
)
RUNTIME_ENV_DEFAULTS: Mapping[str, str] = {
    "AGX_LEARNING_ENABLED": "0",
    "AGX_SESSION_FTS": "0",
    "AGX_SKILL_MANAGE": "0",
}
CommandSandboxMode = Literal["required", "best_effort"]
_POSTGRES_ONLY = "DATABASE_URL: agent-runtime supports PostgreSQL only in this version"


def read_secret(environ: Mapping[str, str], name: str) -> str:
    """NAME_FILE wins over NAME. Whitespace is stripped."""
    file_path = str(environ.get(f"{name}_FILE", "") or "").strip()
    if file_path:
        return Path(file_path).read_text(encoding="utf-8").strip()
    return str(environ.get(name, "") or "").strip()


def _raw(environ: Mapping[str, str], name: str) -> str:
    return str(environ.get(name, "") or "").strip()


def resolve_quota_timezone(raw: str) -> str:
    """Return an IANA name. Empty means Asia/Shanghai. Unknown names refuse startup."""
    name = raw.strip() or "Asia/Shanghai"
    try:
        ZoneInfo(name)
    except ZoneInfoNotFoundError:
        raise RuntimeError(f"MA_QUOTA_TIMEZONE: unknown IANA timezone {name}") from None
    return name


def _bounded_float(
    environ: Mapping[str, str],
    name: str,
    default: float,
    low: float,
    high: float,
) -> float:
    raw = _raw(environ, name)
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ValueError(f"{name}: must be between {low:g} and {high:g}") from None
    if value < low or value > high:
        raise ValueError(f"{name}: must be between {low:g} and {high:g}")
    return value


def _bounded_int(
    environ: Mapping[str, str],
    name: str,
    default: int,
    low: int,
    high: int,
) -> int:
    raw = _raw(environ, name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name}: must be an integer between {low} and {high}") from None
    if value < low or value > high:
        raise ValueError(f"{name}: must be an integer between {low} and {high}")
    return value


def _task_max_runtime(environ: Mapping[str, str]) -> float:
    foreground = _bounded_float(
        environ,
        "MA_RUNTIME_TASK_FOREGROUND_SECONDS",
        60.0,
        5.0,
        600.0,
    )
    maximum = _bounded_float(
        environ,
        "MA_RUNTIME_TASK_MAX_RUNTIME_SECONDS",
        3600.0,
        60.0,
        86400.0,
    )
    if maximum < foreground:
        raise ValueError(
            "MA_RUNTIME_TASK_MAX_RUNTIME_SECONDS: must be >= MA_RUNTIME_TASK_FOREGROUND_SECONDS"
        )
    return maximum


def _sandbox_mode(value: str) -> CommandSandboxMode:
    if value == "best_effort":
        return "best_effort"
    return "required"


def _float_ok(
    environ: Mapping[str, str],
    name: str,
    default: float,
    predicate,
    *,
    fallback: bool,
    reason: str,
) -> float:
    raw = _raw(environ, name)
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        if fallback:
            return default
        raise RuntimeError(f"{name}: {reason}") from None
    if not predicate(value):
        if fallback:
            return default
        raise RuntimeError(f"{name}: {reason}")
    return value


def _int_ok(
    environ: Mapping[str, str],
    name: str,
    default: int,
    predicate,
    *,
    reason: str,
) -> int:
    raw = _raw(environ, name)
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise RuntimeError(f"{name}: {reason}") from None
    if not predicate(value):
        raise RuntimeError(f"{name}: {reason}")
    return value


@dataclass(frozen=True)
class Settings:
    """Process settings. Secrets stay on this object after the environment is scrubbed."""

    database_url: str
    internal_token: str
    admin_url: str
    gateway_url: str
    gateway_token: str
    home: Path
    registry_cache_seconds: float = 10.0
    pat_cache_seconds: float = 30.0
    llm_timeout_seconds: float = 300.0
    command_sandbox: CommandSandboxMode = "required"
    desktop_worker_enabled: bool = False
    implicit_local_env: bool = True
    interrupt_grace_seconds: float = 3.0
    db_pool_size: int = 10
    allow_sqlite: bool = False
    desktop_pat_enabled: bool = False
    eligibility_cache_seconds: float = 30.0
    credentials_enabled: bool = True
    egress_enforce: bool = True
    memory_enabled: bool = True
    scheduler_enabled: bool = False
    scheduler_tick_seconds: float = 15.0
    schedule_run_timeout_seconds: float = 3600.0
    webhooks_enabled: bool = False
    webhook_max_attempts: int = 6
    webhook_allow_loopback: bool = False
    webhook_block_private: bool = False
    webhook_config_cache_seconds: float = 30.0
    channels_enabled: bool = False
    channel_reply_timeout_seconds: float = 300.0
    channel_max_concurrency: int = 8
    channel_reconcile_seconds: float = 30.0
    channel_poll_seconds: float = 1.0
    channel_inbound_retention_days: int = 7
    agent_quota_enabled: bool = False
    agent_quota_cache_seconds: float = 30.0
    agent_quota_stale_seconds: float = 600.0
    quota_timezone: str = "Asia/Shanghai"
    tasks_enabled: bool = False
    threads_enabled: bool = False
    task_foreground_seconds: float = 60.0
    task_max_runtime_seconds: float = 3600.0
    max_running_tasks: int = 8
    # MA-E12. MA-A10 may add settings beside these three.
    evals_enabled: bool = False
    eval_item_timeout_seconds: float = 600.0
    eval_max_concurrent_runs: int = 1
    # MA-A10 memory dreams. Off unless the flag is exactly "1".
    dreams_enabled: bool = False
    dream_timeout_seconds: float = 7200.0
    dream_max_concurrent: int = 1

    @classmethod
    def from_env(cls, environ: Mapping[str, str] | None = None) -> "Settings":
        """Load settings. Every failure is ``RuntimeError`` starting with the variable name."""
        env = os.environ if environ is None else environ
        dialect = _raw(env, "DATABASE_DIALECT")
        if dialect and dialect != "postgresql":
            raise RuntimeError(_POSTGRES_ONLY)
        database_url = _raw(env, "DATABASE_URL")
        if not database_url:
            raise RuntimeError("DATABASE_URL: is required")
        allow_sqlite = _raw(env, "MA_RUNTIME_ALLOW_SQLITE") == "1"
        if database_url.startswith("mysql://") or database_url.startswith("mysql+"):
            raise RuntimeError(_POSTGRES_ONLY)
        postgres = database_url.startswith("postgresql://") or database_url.startswith(
            "postgres://"
        )
        sqlite = database_url.startswith("sqlite:///")
        if postgres:
            pass
        elif sqlite and allow_sqlite:
            pass
        elif sqlite:
            raise RuntimeError(_POSTGRES_ONLY)
        else:
            raise RuntimeError(_POSTGRES_ONLY)

        internal_token = read_secret(env, "MA_INTERNAL_TOKEN")
        if not internal_token:
            raise RuntimeError(
                "MA_INTERNAL_TOKEN: (or _FILE) is required; refusing to start"
            )

        admin_url = _raw(env, "MA_RUNTIME_ADMIN_URL") or DEFAULT_ADMIN_URL
        if not (admin_url.startswith("http://") or admin_url.startswith("https://")):
            raise RuntimeError(
                "MA_RUNTIME_ADMIN_URL: must start with http:// or https://"
            )
        admin_url = admin_url.rstrip("/")

        gateway_url = _raw(env, "MA_RUNTIME_GATEWAY_URL") or DEFAULT_GATEWAY_URL
        gateway_url = gateway_url.rstrip("/")
        if not gateway_url.endswith("/v1"):
            raise RuntimeError("MA_RUNTIME_GATEWAY_URL: must end with /v1")

        gateway_token = read_secret(env, "MA_RUNTIME_GATEWAY_TOKEN")
        if not gateway_token:
            raise RuntimeError(
                "MA_RUNTIME_GATEWAY_TOKEN: (or _FILE) is required; refusing to start"
            )
        if not gateway_token.startswith("agx-pat-"):
            raise RuntimeError("MA_RUNTIME_GATEWAY_TOKEN: must be an agx-pat- token")

        home_raw = _raw(env, "MA_RUNTIME_HOME")
        if not home_raw:
            raise RuntimeError("MA_RUNTIME_HOME: is required")
        home = Path(home_raw)
        if not home.is_absolute():
            raise RuntimeError("MA_RUNTIME_HOME: must be an absolute path")
        process_home = _raw(env, "HOME")
        if not process_home:
            raise RuntimeError("HOME: is required")
        if Path(process_home).expanduser().resolve() != home.expanduser().resolve():
            raise RuntimeError("HOME: must equal MA_RUNTIME_HOME")

        sandbox = _raw(env, "MA_RUNTIME_COMMAND_SANDBOX") or "required"
        if sandbox not in ("required", "best_effort"):
            raise RuntimeError(
                "MA_RUNTIME_COMMAND_SANDBOX: must be required or best_effort"
            )

        return cls(
            database_url=database_url,
            internal_token=internal_token,
            admin_url=admin_url,
            gateway_url=gateway_url,
            gateway_token=gateway_token,
            home=home.expanduser().resolve(),
            registry_cache_seconds=_float_ok(
                env,
                "MA_RUNTIME_REGISTRY_CACHE_SECONDS",
                10.0,
                lambda value: value >= 0,
                fallback=True,
                reason="must be >= 0",
            ),
            pat_cache_seconds=_float_ok(
                env,
                "MA_RUNTIME_PAT_CACHE_SECONDS",
                30.0,
                lambda value: 0 <= value <= 300,
                fallback=True,
                reason="must be between 0 and 300",
            ),
            llm_timeout_seconds=_float_ok(
                env,
                "MA_RUNTIME_LLM_TIMEOUT_SECONDS",
                300.0,
                lambda value: value > 0,
                fallback=False,
                reason="must be > 0",
            ),
            command_sandbox=_sandbox_mode(sandbox),
            desktop_worker_enabled=_raw(env, "MA_RUNTIME_DESKTOP_WORKER_ENABLED")
            == "1",
            implicit_local_env=_raw(env, "MA_RUNTIME_IMPLICIT_LOCAL_ENV") != "0",
            interrupt_grace_seconds=_float_ok(
                env,
                "MA_RUNTIME_INTERRUPT_GRACE_SECONDS",
                3.0,
                lambda value: 0.5 <= value <= 30,
                fallback=False,
                reason="must be between 0.5 and 30",
            ),
            db_pool_size=_int_ok(
                env,
                "MA_RUNTIME_DB_POOL_SIZE",
                10,
                lambda value: 1 <= value <= 50,
                reason="must be an integer between 1 and 50",
            ),
            allow_sqlite=allow_sqlite,
            desktop_pat_enabled=_raw(env, "MA_RUNTIME_DESKTOP_PAT_ENABLED") == "1",
            eligibility_cache_seconds=_float_ok(
                env,
                "MA_RUNTIME_ELIGIBILITY_CACHE_SECONDS",
                30.0,
                lambda value: 0 <= value <= 300,
                fallback=True,
                reason="must be between 0 and 300",
            ),
            credentials_enabled=_raw(env, "MA_RUNTIME_CREDENTIALS_ENABLED") != "0",
            egress_enforce=_raw(env, "MA_RUNTIME_EGRESS_ENFORCE") != "0",
            memory_enabled=_raw(env, "MA_RUNTIME_MEMORY_ENABLED") != "0",
            scheduler_enabled=_raw(env, "MA_RUNTIME_SCHEDULER_ENABLED") == "1",
            scheduler_tick_seconds=_float_ok(
                env,
                "MA_RUNTIME_SCHEDULER_TICK_SECONDS",
                15.0,
                lambda value: 5 <= value <= 300,
                fallback=True,
                reason="must be between 5 and 300",
            ),
            schedule_run_timeout_seconds=_float_ok(
                env,
                "MA_RUNTIME_SCHEDULE_RUN_TIMEOUT_SECONDS",
                3600.0,
                lambda value: 60 <= value <= 86400,
                fallback=True,
                reason="must be between 60 and 86400",
            ),
            webhooks_enabled=_raw(env, "MA_RUNTIME_WEBHOOKS_ENABLED") == "1",
            webhook_max_attempts=_int_ok(
                env,
                "MA_RUNTIME_WEBHOOK_MAX_ATTEMPTS",
                6,
                lambda value: 1 <= value <= 10,
                reason="must be an integer between 1 and 10",
            ),
            webhook_allow_loopback=_raw(env, "MA_WEBHOOK_ALLOW_LOOPBACK") == "1",
            webhook_block_private=_raw(env, "MA_WEBHOOK_BLOCK_PRIVATE") == "1",
            webhook_config_cache_seconds=_float_ok(
                env,
                "MA_RUNTIME_WEBHOOK_CONFIG_CACHE_SECONDS",
                30.0,
                lambda value: 0 <= value <= 300,
                fallback=True,
                reason="must be between 0 and 300",
            ),
            channels_enabled=_raw(env, "MA_RUNTIME_CHANNELS_ENABLED") == "1",
            channel_reply_timeout_seconds=_float_ok(
                env,
                "MA_RUNTIME_CHANNEL_REPLY_TIMEOUT_SECONDS",
                300.0,
                lambda value: 10 <= value <= 1800,
                fallback=True,
                reason="must be between 10 and 1800",
            ),
            channel_max_concurrency=_int_ok(
                env,
                "MA_RUNTIME_CHANNEL_MAX_CONCURRENCY",
                8,
                lambda value: 1 <= value <= 64,
                reason="must be an integer between 1 and 64",
            ),
            channel_reconcile_seconds=_float_ok(
                env,
                "MA_RUNTIME_CHANNEL_RECONCILE_SECONDS",
                30.0,
                lambda value: 5 <= value <= 300,
                fallback=True,
                reason="must be between 5 and 300",
            ),
            channel_poll_seconds=_float_ok(
                env,
                "MA_RUNTIME_CHANNEL_POLL_SECONDS",
                1.0,
                lambda value: 0.2 <= value <= 10,
                fallback=True,
                reason="must be between 0.2 and 10",
            ),
            channel_inbound_retention_days=_int_ok(
                env,
                "MA_RUNTIME_CHANNEL_INBOUND_RETENTION_DAYS",
                7,
                lambda value: 1 <= value <= 90,
                reason="must be an integer between 1 and 90",
            ),
            agent_quota_enabled=_raw(env, "MA_RUNTIME_AGENT_QUOTA_ENABLED") == "1",
            agent_quota_cache_seconds=_float_ok(
                env,
                "MA_RUNTIME_AGENT_QUOTA_CACHE_SECONDS",
                30.0,
                lambda value: 0 <= value <= 300,
                fallback=True,
                reason="must be between 0 and 300",
            ),
            agent_quota_stale_seconds=_float_ok(
                env,
                "MA_RUNTIME_AGENT_QUOTA_STALE_SECONDS",
                600.0,
                lambda value: 0 <= value <= 3600,
                fallback=True,
                reason="must be between 0 and 3600",
            ),
            quota_timezone=resolve_quota_timezone(_raw(env, "MA_QUOTA_TIMEZONE")),
            tasks_enabled=_raw(env, "MA_RUNTIME_TASKS_ENABLED") == "1",
            threads_enabled=_raw(env, "MA_RUNTIME_THREADS_ENABLED") == "1",
            task_foreground_seconds=_bounded_float(
                env,
                "MA_RUNTIME_TASK_FOREGROUND_SECONDS",
                60.0,
                5.0,
                600.0,
            ),
            task_max_runtime_seconds=_task_max_runtime(env),
            max_running_tasks=_bounded_int(
                env,
                "MA_RUNTIME_MAX_RUNNING_TASKS",
                8,
                1,
                32,
            ),
            # MA-E12. Keep this block together so MA-A10 can land beside it.
            evals_enabled=_raw(env, "MA_RUNTIME_EVALS_ENABLED") == "1",
            eval_item_timeout_seconds=_bounded_float(
                env,
                "MA_EVAL_ITEM_TIMEOUT_SECONDS",
                600.0,
                30.0,
                3600.0,
            ),
            eval_max_concurrent_runs=_bounded_int(
                env,
                "MA_EVAL_MAX_CONCURRENT_RUNS",
                1,
                1,
                8,
            ),
            dreams_enabled=_raw(env, "MA_RUNTIME_DREAMS_ENABLED") == "1",
            dream_timeout_seconds=_bounded_float(
                env,
                "MA_DREAM_TIMEOUT_SECONDS",
                7200.0,
                300.0,
                86400.0,
            ),
            dream_max_concurrent=_bounded_int(
                env,
                "MA_DREAM_MAX_CONCURRENT",
                1,
                1,
                4,
            ),
        )


def apply_runtime_env_defaults(environ: MutableMapping[str, str] | None = None) -> None:
    """setdefault each runtime default so personal-mode features stay off."""
    target = os.environ if environ is None else environ
    for key, value in RUNTIME_ENV_DEFAULTS.items():
        target.setdefault(key, value)


def scrub_secret_env(environ: MutableMapping[str, str] | None = None) -> list[str]:
    """Delete secret-like keys. The return value is sorted names, never values."""
    target = os.environ if environ is None else environ
    removed = [key for key in list(target) if SECRET_ENV_RE.fullmatch(key)]
    for key in removed:
        del target[key]
    return sorted(removed)


__all__ = [
    "DEFAULT_ADMIN_URL",
    "DEFAULT_GATEWAY_URL",
    "RUNTIME_ENV_DEFAULTS",
    "SECRET_ENV_RE",
    "CommandSandboxMode",
    "Settings",
    "apply_runtime_env_defaults",
    "read_secret",
    "resolve_quota_timezone",
    "scrub_secret_env",
]
