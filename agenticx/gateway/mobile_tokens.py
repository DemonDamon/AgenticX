#!/usr/bin/env python3
"""Persistent mobile install tokens for the /api/mobile/* surface.

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional


class MobileTokenStore:
    """Maps install_id -> {device_id, token, issued_at}; JSON-file backed.

    Persistence follows the user_device_map.py convention: in-memory dict,
    atomic tmp-file + rename on every write.
    """

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._data: Dict[str, Dict[str, Any]] = {}
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            with self._path.open("r", encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                self._data = {k: v for k, v in raw.items() if isinstance(v, dict)}
        except (OSError, json.JSONDecodeError):
            pass

    def _save(self) -> None:
        tmp = self._path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)
        tmp.replace(self._path)

    def issue(self, install_id: str, device_id: str) -> str:
        install_id = (install_id or "").strip()
        device_id = (device_id or "").strip()
        if not install_id or not device_id:
            raise ValueError("install_id and device_id required")
        token = secrets.token_hex(32)
        with self._lock:
            # 同 install_id 重复签发为覆盖式：旧 token 立即失效
            self._data[install_id] = {
                "device_id": device_id,
                "token": token,
                "issued_at": time.time(),
            }
            self._save()
        return token

    def verify(self, install_id: str, device_id: str, token: str) -> bool:
        with self._lock:
            entry = self._data.get((install_id or "").strip())
        if not isinstance(entry, dict):
            return False
        stored = str(entry.get("token") or "")
        candidate = (token or "").strip()
        if not stored or not candidate:
            return False
        # compare_digest 对 str 要求 ASCII-only；编码为 bytes 后任意输入都安全
        match = secrets.compare_digest(stored.encode("utf-8"), candidate.encode("utf-8"))
        return match and str(entry.get("device_id") or "").strip() == (device_id or "").strip()

    def revoke(self, install_id: str) -> bool:
        key = (install_id or "").strip()
        with self._lock:
            if key not in self._data:
                return False
            del self._data[key]
            self._save()
        return True

    def get_device(self, install_id: str) -> Optional[str]:
        with self._lock:
            entry = self._data.get((install_id or "").strip())
        if not isinstance(entry, dict):
            return None
        did = str(entry.get("device_id") or "").strip()
        return did or None


def resolve_mobile_tokens_path(config_path: Optional[Path] = None) -> Path:
    """Token file location: env override > config-adjacent > default home path."""
    env = os.getenv("AGX_MOBILE_TOKEN_FILE", "").strip()
    if env:
        return Path(env).expanduser()
    if config_path is not None:
        return config_path.parent / f"{config_path.name}.mobile_tokens.json"
    return Path.home() / ".agenticx" / "gateway" / "mobile_tokens.json"
