"""KBManager — compatibility shim delegating to default docs brain.

Plan-Id: 2026-05-20-multi-brain-knowledge-architecture
Legacy ``/api/kb/*`` and ``KBManager.instance()`` callers route to the
bootstrapped global docs brain (``default_docs``).
"""

from __future__ import annotations

import logging
import os
import threading
from pathlib import Path
from typing import Any, Dict, Optional

from .contracts import KBConfig
from .jobs import JobRegistry
from .runtime import KBRuntime

logger = logging.getLogger(__name__)

_CONFIG_KEY = "knowledge_base"
_DEFAULT_CONFIG_PATH = "~/.agenticx/config.yaml"


def _default_docs_runtime():
    from agenticx.brain.manager import BrainManager
    from agenticx.brain.registry import BrainRegistry

    BrainRegistry.instance().bootstrap()
    return BrainManager.instance().default_docs_runtime()


class KBManager:
    """Deprecated singleton; delegates to :class:`agenticx.brain.DocsBrainRuntime`."""

    _instance_lock = threading.RLock()
    _instance: "Optional[KBManager]" = None

    @classmethod
    def instance(cls, *, config_path: Optional[str] = None) -> "KBManager":
        with cls._instance_lock:
            if cls._instance is None:
                cls._instance = cls(config_path=config_path or _DEFAULT_CONFIG_PATH)
            return cls._instance

    @classmethod
    def reset_for_tests(cls) -> None:
        with cls._instance_lock:
            if cls._instance is not None:
                try:
                    rt = _default_docs_runtime()
                    rt.jobs.shutdown(wait=False)
                except Exception:  # pragma: no cover
                    pass
            cls._instance = None
            try:
                from agenticx.brain.manager import BrainManager
                from agenticx.brain.registry import BrainRegistry

                BrainManager.reset_for_tests()
                BrainRegistry.reset_for_tests()
            except Exception:
                pass

    def __init__(self, *, config_path: str) -> None:
        self._config_path = Path(os.path.expanduser(config_path))
        self._lock = threading.RLock()

    @property
    def runtime(self) -> KBRuntime:
        return _default_docs_runtime().runtime

    @property
    def jobs(self) -> JobRegistry:
        return _default_docs_runtime().jobs

    @property
    def config_path(self) -> Path:
        return self._config_path

    def read_config(self) -> KBConfig:
        return _default_docs_runtime().read_config()

    def write_config(self, new_config: KBConfig) -> Dict[str, Any]:
        logger.debug("KBManager.write_config delegates to default docs brain")
        with self._lock:
            result = _default_docs_runtime().write_config(new_config)
            # Mirror into legacy config.yaml for external tools still reading it.
            try:
                import yaml

                raw: Dict[str, Any] = {}
                if self._config_path.exists():
                    loaded = yaml.safe_load(self._config_path.read_text(encoding="utf-8"))
                    if isinstance(loaded, dict):
                        raw = loaded
                raw[_CONFIG_KEY] = new_config.to_dict()
                self._config_path.parent.mkdir(parents=True, exist_ok=True)
                tmp = self._config_path.with_suffix(".tmp")
                tmp.write_text(
                    yaml.safe_dump(raw, allow_unicode=True, sort_keys=False),
                    encoding="utf-8",
                )
                tmp.replace(self._config_path)
            except Exception as exc:
                logger.warning("KBManager legacy yaml mirror failed: %s", exc)
            return result
