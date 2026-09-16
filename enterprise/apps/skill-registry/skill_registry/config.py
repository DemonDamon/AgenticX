"""服务配置。全部来自环境变量，没有配置文件。"""

from __future__ import annotations

import os
from dataclasses import dataclass


def _read_secret(name: str) -> str:
    """认 NAME 和 NAME_FILE 两种写法。

    PEM、长随机串塞不进 .env，Docker/K8s 也习惯挂 secret 文件。企业侧其它组件
    （auth 的 jwt、gateway 的 internal token）已经是这个行为，这里保持一致，
    免得又出现「变量明明配了，报错却说没配」。
    """
    path = os.environ.get(f"{name}_FILE", "").strip()
    if path:
        try:
            with open(path, "r", encoding="utf-8") as handle:
                return handle.read().strip()
        except OSError as exc:
            raise RuntimeError(f"{name}_FILE is set but unreadable: {exc}") from exc
    return os.environ.get(name, "").strip()


@dataclass(frozen=True)
class Settings:
    internal_token: str
    max_bundle_bytes: int
    fetch_timeout_seconds: float

    @classmethod
    def from_env(cls) -> "Settings":
        token = _read_secret("SKILL_REGISTRY_INTERNAL_TOKEN")
        if not token:
            # 没有 token 就不启动，而不是裸奔监听。这个服务能出公网、能解包，
            # 是这套部署里最不该匿名可达的一个。
            raise RuntimeError(
                "SKILL_REGISTRY_INTERNAL_TOKEN (or _FILE) is required; refusing to start unauthenticated"
            )
        return cls(
            internal_token=token,
            max_bundle_bytes=_positive_int("SKILL_REGISTRY_MAX_BUNDLE_BYTES", 32 * 1024 * 1024),
            fetch_timeout_seconds=float(_positive_int("SKILL_REGISTRY_FETCH_TIMEOUT_SECONDS", 30)),
        )


def _positive_int(name: str, fallback: int) -> int:
    raw = os.environ.get(name, "").strip()
    if not raw:
        return fallback
    try:
        value = int(raw)
    except ValueError:
        return fallback
    return value if value > 0 else fallback
