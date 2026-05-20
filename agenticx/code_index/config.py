"""Configuration helpers for the code_index subsystem."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from agenticx.cli.config_manager import ConfigManager

_CONFIG_KEY = "code_index"


@dataclass(frozen=True)
class CodeIndexConfig:
    enabled: bool = False
    backend: str = "semble"
    preload_model: bool = False
    max_index_memory_mb: int = 1024
    semble_search_mode: str = "hybrid"
    semble_default_top_k: int = 10
    semble_include_text_files: bool = False
    semble_model: str = "minishlab/potion-code-16M"


def _nested(cfg: dict[str, Any], *keys: str, default: Any = None) -> Any:
    cur: Any = cfg
    for key in keys:
        if not isinstance(cur, dict):
            return default
        cur = cur.get(key)
    return default if cur is None else cur


def load_code_index_config() -> CodeIndexConfig:
    try:
        raw = ConfigManager.get_value(_CONFIG_KEY)
    except Exception:
        raw = None
    if not isinstance(raw, dict):
        raw = {}
    top_k = _nested(raw, "semble", "default_top_k", default=10)
    try:
        top_k_int = int(top_k)
    except (TypeError, ValueError):
        top_k_int = 10
    mem = _nested(raw, "max_index_memory_mb", default=1024)
    try:
        mem_int = int(mem)
    except (TypeError, ValueError):
        mem_int = 1024
    return CodeIndexConfig(
        enabled=bool(_nested(raw, "enabled", default=False)),
        backend=str(_nested(raw, "backend", default="semble") or "semble"),
        preload_model=bool(_nested(raw, "preload_model", default=False)),
        max_index_memory_mb=max(128, min(8192, mem_int)),
        semble_search_mode=str(_nested(raw, "semble", "search_mode", default="hybrid") or "hybrid"),
        semble_default_top_k=max(1, min(50, top_k_int)),
        semble_include_text_files=bool(_nested(raw, "semble", "include_text_files", default=False)),
        semble_model=str(_nested(raw, "semble", "model", default="minishlab/potion-code-16M") or "minishlab/potion-code-16M"),
    )


def is_enabled() -> bool:
    return load_code_index_config().enabled
