#!/usr/bin/env python3
"""Persist IM sender to device_id bindings (gateway server side).

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Dict, Optional


_BIND_RE = re.compile(r"^\s*绑定\s+(\S+)\s*$", re.IGNORECASE)
_NEW_CHAT_RE = re.compile(r"^\s*/新对话\s*$", re.IGNORECASE)
_STATUS_RE = re.compile(r"^\s*/状态\s*$", re.IGNORECASE)
_CANCEL_RE = re.compile(r"^\s*/取消\s*$", re.IGNORECASE)


class UserDeviceMap:
    """Maps (platform, sender_id) -> device_id with optional binding_code registry."""

    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.Lock()
        self._path.parent.mkdir(parents=True, exist_ok=True)
        self._data: Dict[str, Any] = {"bindings": {}, "binding_codes": {}}
        self._load()

    def _load(self) -> None:
        if not self._path.exists():
            return
        try:
            with self._path.open("r", encoding="utf-8") as f:
                raw = json.load(f)
            if isinstance(raw, dict):
                self._data = {
                    "bindings": raw.get("bindings") if isinstance(raw.get("bindings"), dict) else {},
                    "binding_codes": raw.get("binding_codes")
                    if isinstance(raw.get("binding_codes"), dict)
                    else {},
                }
        except (OSError, json.JSONDecodeError):
            pass

    def _save(self) -> None:
        tmp = self._path.with_suffix(".tmp")
        with tmp.open("w", encoding="utf-8") as f:
            json.dump(self._data, f, ensure_ascii=False, indent=2)
        tmp.replace(self._path)

    def key(self, platform: str, sender_id: str) -> str:
        return f"{platform}:{sender_id}"

    def get_device(self, platform: str, sender_id: str) -> Optional[str]:
        with self._lock:
            b = self._data.get("bindings", {})
            entry = b.get(self.key(platform, sender_id))
            if isinstance(entry, str):
                return entry
            if isinstance(entry, dict):
                return str(entry.get("device_id") or "").strip() or None
            return None

    def set_binding(self, platform: str, sender_id: str, device_id: str) -> None:
        with self._lock:
            self._data.setdefault("bindings", {})[self.key(platform, sender_id)] = {
                "device_id": device_id,
                "bound_at": time.time(),
            }
            self._save()

    def register_binding_code(self, code: str, device_id: str) -> None:
        code = (code or "").strip()
        if not code:
            return
        with self._lock:
            self._data.setdefault("binding_codes", {})[code] = device_id
            self._save()

    def resolve_binding_code(self, code: str) -> Optional[str]:
        with self._lock:
            return self._data.get("binding_codes", {}).get((code or "").strip())

    def try_parse_bind_command(self, text: str) -> Optional[str]:
        m = _BIND_RE.match(text or "")
        if not m:
            return None
        return m.group(1).strip()

    @staticmethod
    def is_new_chat_command(text: str) -> bool:
        return bool(_NEW_CHAT_RE.match(text or ""))

    @staticmethod
    def is_status_command(text: str) -> bool:
        return bool(_STATUS_RE.match(text or ""))

    @staticmethod
    def is_cancel_command(text: str) -> bool:
        return bool(_CANCEL_RE.match(text or ""))


def default_bindings_path() -> Path:
    env = os.getenv("AGX_GATEWAY_BINDINGS_PATH", "").strip()
    if env:
        return Path(env).expanduser()
    return Path.home() / ".agenticx" / "gateway" / "device_bindings.json"
