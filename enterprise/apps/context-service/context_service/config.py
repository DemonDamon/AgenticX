"""服务配置。全部来自环境变量，没有配置文件。

与 skill-registry 保持同一约定：token 认 NAME 和 NAME_FILE 两种写法；没有 token
就拒绝启动——这个服务托管的是全公司共享的知识产物，不该匿名可达。
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _read_secret(name: str) -> str:
    path = os.environ.get(f"{name}_FILE", "").strip()
    if path:
        with open(path, "r", encoding="utf-8") as handle:
            return handle.read().strip()
    return os.environ.get(name, "").strip()


def _env(name: str, fallback: str) -> str:
    return os.environ.get(name, "").strip() or fallback


def _positive_int(name: str, fallback: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return fallback
    try:
        value = int(raw)
    except ValueError:
        return fallback
    return value if value > 0 else fallback


@dataclass(frozen=True)
class Settings:
    internal_token: str
    storage_root: Path
    embedding_provider: str
    embedding_model: str
    embedding_dim: int
    embedding_base_url: str
    wiki_provider: str
    wiki_model: str
    default_top_k: int

    @classmethod
    def from_env(cls) -> "Settings":
        token = _read_secret("CONTEXT_SERVICE_INTERNAL_TOKEN")
        if not token:
            raise RuntimeError(
                "CONTEXT_SERVICE_INTERNAL_TOKEN (or _FILE) is required; "
                "refusing to start unauthenticated"
            )
        return cls(
            internal_token=token,
            storage_root=Path(_env("CONTEXT_STORAGE_ROOT", "./context_data")).expanduser(),
            embedding_provider=_env("CONTEXT_EMBEDDING_PROVIDER", "ollama"),
            embedding_model=_env("CONTEXT_EMBEDDING_MODEL", "bge-m3"),
            embedding_dim=_positive_int("CONTEXT_EMBEDDING_DIM", 1024),
            embedding_base_url=_env(
                "CONTEXT_EMBEDDING_BASE_URL", "http://localhost:11434"
            ),
            wiki_provider=_env("CONTEXT_WIKI_PROVIDER", ""),
            wiki_model=_env("CONTEXT_WIKI_MODEL", ""),
            default_top_k=_positive_int("CONTEXT_DEFAULT_TOP_K", 5),
        )
