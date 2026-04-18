"""Process-wide singleton holding the KBRuntime + JobRegistry pair.

Plan-Id: machi-kb-stage1-local-mvp
Plan-File: .cursor/plans/2026-04-14-machi-kb-stage1-local-mvp.plan.md

A singleton is appropriate here because the Machi user-facing KB is "one
global KB" per plan §0; per-session isolation is a Stage-2 concern.
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, Optional

import yaml

from .contracts import KBConfig
from .jobs import JobRegistry
from .runtime import KBRuntime

logger = logging.getLogger(__name__)

_CONFIG_KEY = "knowledge_base"
_DEFAULT_CONFIG_PATH = "~/.agenticx/config.yaml"


class KBManager:
    """Reads / writes ``~/.agenticx/config.yaml : knowledge_base`` and
    owns the ``KBRuntime`` + ``JobRegistry`` for the running process."""

    _instance_lock = threading.RLock()
    _instance: "Optional[KBManager]" = None

    # ----- class-level singleton access -----------------------------------

    @classmethod
    def instance(cls, *, config_path: Optional[str] = None) -> "KBManager":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls(config_path=config_path or _DEFAULT_CONFIG_PATH)
            return cls._instance

    @classmethod
    def reset_for_tests(cls) -> None:
        with cls._instance_lock:
            if cls._instance is not None and cls._instance._jobs is not None:
                try:
                    cls._instance._jobs.shutdown(wait=False)
                except Exception:  # pragma: no cover
                    pass
            cls._instance = None

    # ----- instance -------------------------------------------------------

    def __init__(self, *, config_path: str) -> None:
        self._config_path = Path(os.path.expanduser(config_path))
        self._lock = threading.RLock()
        config = self._load_config_from_disk()
        self._runtime = KBRuntime(config=config)
        self._jobs = JobRegistry(max_workers=2)

    @property
    def runtime(self) -> KBRuntime:
        return self._runtime

    @property
    def jobs(self) -> JobRegistry:
        return self._jobs

    @property
    def config_path(self) -> Path:
        return self._config_path

    # ----------------------------- config io ------------------------------

    def _load_raw_yaml(self) -> Dict[str, Any]:
        if not self._config_path.exists():
            return {}
        try:
            raw = yaml.safe_load(self._config_path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.warning("config %s unreadable: %s", self._config_path, exc)
            return {}
        return raw if isinstance(raw, dict) else {}

    def _load_config_from_disk(self) -> KBConfig:
        raw = self._load_raw_yaml()
        node = raw.get(_CONFIG_KEY)
        return KBConfig.from_dict(node if isinstance(node, dict) else None)

    def read_config(self) -> KBConfig:
        return self._runtime.config

    def write_config(self, new_config: KBConfig) -> Dict[str, Any]:
        """Persist into YAML and swap the runtime's view.

        Returns a dict including ``rebuild_required`` so the caller (route)
        can surface it to the UI per plan §1.2.
        """

        with self._lock:
            raw = self._load_raw_yaml()
            raw[_CONFIG_KEY] = new_config.to_dict()
            self._config_path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self._config_path.with_suffix(".tmp")
            tmp.write_text(yaml.safe_dump(raw, allow_unicode=True, sort_keys=False), encoding="utf-8")
            tmp.replace(self._config_path)
            return self._runtime.update_config(new_config)
