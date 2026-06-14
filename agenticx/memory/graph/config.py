#!/usr/bin/env python3
"""Memory graph configuration loaded from ~/.agenticx/config.yaml.

Author: Damon Li
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Optional


DEFAULT_GRAPH_DB = Path.home() / ".agenticx" / "memory" / "graph.kuzu"
DEFAULT_STATUS_PATH = Path.home() / ".agenticx" / "memory" / "graph_ingest.json"


@dataclass
class MemoryGraphIngestConfig:
    """Ingest queue knobs."""

    auto: bool = True
    max_queue: int = 32
    semaphore_limit: int = 2
    max_chars_per_episode: int = 4096


@dataclass
class MemoryGraphProviderConfig:
    """Optional LLM/embedder override."""

    provider: str = ""
    model: str = ""


@dataclass
class MemoryGraphConfig:
    """Top-level memory graph settings."""

    enabled: bool = False
    backend: str = "kuzu"
    db_path: Path = field(default_factory=lambda: DEFAULT_GRAPH_DB)
    default_scope: str = "meta"
    ingest: MemoryGraphIngestConfig = field(default_factory=MemoryGraphIngestConfig)
    llm: MemoryGraphProviderConfig = field(default_factory=MemoryGraphProviderConfig)
    embedder: MemoryGraphProviderConfig = field(default_factory=MemoryGraphProviderConfig)
    telemetry: bool = False
    status_path: Path = field(default_factory=lambda: DEFAULT_STATUS_PATH)
    search_in_chat: bool = True
    search_in_chat_graph_limit: int = 2


def _coerce_bool(value: Any, default: bool) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    return default


def _coerce_int(value: Any, default: int, *, minimum: int = 0) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return default
    return max(minimum, parsed)


def load_memory_graph_config() -> MemoryGraphConfig:
    """Load memory_graph section from env + global config."""
    cfg = MemoryGraphConfig()
    raw_enabled = os.environ.get("AGX_MEMORY_GRAPH_ENABLED", "").strip().lower()
    # 环境变量是最高优先级显式开关，必须能压过 config.yaml 的 enabled 值
    env_enabled: Optional[bool] = None
    if raw_enabled in {"1", "true", "yes", "on"}:
        env_enabled = True
    elif raw_enabled in {"0", "false", "no", "off"}:
        env_enabled = False
    if env_enabled is not None:
        cfg.enabled = env_enabled

    raw_search_in_chat = os.environ.get("AGX_MEMORY_GRAPH_SEARCH_IN_CHAT", "").strip().lower()
    env_search_in_chat: Optional[bool] = None
    if raw_search_in_chat in {"1", "true", "yes", "on"}:
        env_search_in_chat = True
    elif raw_search_in_chat in {"0", "false", "no", "off"}:
        env_search_in_chat = False
    if env_search_in_chat is not None:
        cfg.search_in_chat = env_search_in_chat

    try:
        from agenticx.cli.config_manager import ConfigManager

        section = ConfigManager.get_value("memory_graph")
    except Exception:
        section = None
    if not isinstance(section, dict):
        return cfg

    # 仅当 env 未显式指定时才采用文件里的 enabled，保证 env 覆盖优先
    if env_enabled is None:
        cfg.enabled = _coerce_bool(section.get("enabled"), cfg.enabled)
    backend = str(section.get("backend", cfg.backend) or cfg.backend).strip().lower()
    if backend:
        cfg.backend = backend

    db_raw = section.get("db_path")
    if db_raw:
        cfg.db_path = Path(str(db_raw)).expanduser()

    scope = str(section.get("default_scope", cfg.default_scope) or cfg.default_scope).strip().lower()
    if scope == "session":
        # 「本会话」已下线，旧配置回落到元智能体分区
        scope = "meta"
    if scope == "user":
        # 「用户」图谱 scope 已下线，回落到元智能体
        scope = "meta"
    if scope in {"avatar", "meta", "group"}:
        cfg.default_scope = scope

    ingest_raw = section.get("ingest")
    if isinstance(ingest_raw, dict):
        cfg.ingest.auto = _coerce_bool(ingest_raw.get("auto"), cfg.ingest.auto)
        cfg.ingest.max_queue = _coerce_int(ingest_raw.get("max_queue"), cfg.ingest.max_queue, minimum=1)
        cfg.ingest.semaphore_limit = _coerce_int(
            ingest_raw.get("semaphore_limit"), cfg.ingest.semaphore_limit, minimum=1
        )
        cfg.ingest.max_chars_per_episode = _coerce_int(
            ingest_raw.get("max_chars_per_episode"),
            cfg.ingest.max_chars_per_episode,
            minimum=256,
        )

    for key, target in (("llm", cfg.llm), ("embedder", cfg.embedder)):
        block = section.get(key)
        if isinstance(block, dict):
            target.provider = str(block.get("provider", target.provider) or "").strip()
            target.model = str(block.get("model", target.model) or "").strip()

    cfg.telemetry = _coerce_bool(section.get("telemetry"), cfg.telemetry)
    if env_search_in_chat is None:
        cfg.search_in_chat = _coerce_bool(section.get("search_in_chat"), cfg.search_in_chat)
    cfg.search_in_chat_graph_limit = _coerce_int(
        section.get("search_in_chat_graph_limit"),
        cfg.search_in_chat_graph_limit,
        minimum=0,
    )
    if not cfg.telemetry:
        os.environ.setdefault("GRAPHITI_TELEMETRY_ENABLED", "false")

    status_raw = section.get("status_path")
    if status_raw:
        cfg.status_path = Path(str(status_raw)).expanduser()

    return cfg


def memory_graph_config_to_dict(cfg: MemoryGraphConfig) -> Dict[str, Any]:
    """Serialize for settings API responses."""
    return {
        "enabled": cfg.enabled,
        "backend": cfg.backend,
        "db_path": str(cfg.db_path),
        "default_scope": cfg.default_scope,
        "ingest": {
            "auto": cfg.ingest.auto,
            "max_queue": cfg.ingest.max_queue,
            "semaphore_limit": cfg.ingest.semaphore_limit,
            "max_chars_per_episode": cfg.ingest.max_chars_per_episode,
        },
        "llm": {"provider": cfg.llm.provider, "model": cfg.llm.model},
        "embedder": {"provider": cfg.embedder.provider, "model": cfg.embedder.model},
        "telemetry": cfg.telemetry,
        "search_in_chat": cfg.search_in_chat,
        "search_in_chat_graph_limit": cfg.search_in_chat_graph_limit,
    }
