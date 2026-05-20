"""BrainManager — lazy runtime cache per brain_id."""

from __future__ import annotations

import threading
from typing import Dict, Optional, Union

from .registry import BrainRegistry
from .runtime_code import CodeBrainRuntime
from .runtime_docs import DocsBrainRuntime
from .types import Brain, BrainType

BrainRuntime = Union[DocsBrainRuntime, CodeBrainRuntime]


class BrainManager:
    _lock = threading.RLock()
    _instance: Optional["BrainManager"] = None

    @classmethod
    def instance(cls) -> "BrainManager":
        with cls._lock:
            if cls._instance is None:
                cls._instance = cls()
            return cls._instance

    @classmethod
    def reset_for_tests(cls) -> None:
        with cls._lock:
            cls._instance = None

    def __init__(self) -> None:
        self._runtimes: Dict[str, BrainRuntime] = {}
        self._rt_lock = threading.RLock()

    def get_brain(self, brain_id: str) -> Optional[Brain]:
        return BrainRegistry.instance().get(brain_id)

    def get_runtime(self, brain_id: str) -> BrainRuntime:
        with self._rt_lock:
            cached = self._runtimes.get(brain_id)
            if cached is not None:
                return cached
            brain = BrainRegistry.instance().get(brain_id)
            if brain is None:
                raise KeyError(f"unknown brain_id: {brain_id}")
            if brain.type == BrainType.DOCS:
                rt: BrainRuntime = DocsBrainRuntime(brain)
            else:
                rt = CodeBrainRuntime(brain)
            self._runtimes[brain_id] = rt
            return rt

    def evict(self, brain_id: str) -> None:
        with self._rt_lock:
            self._runtimes.pop(brain_id, None)

    def default_docs_runtime(self) -> DocsBrainRuntime:
        bid = BrainRegistry.instance().default_docs_brain_id()
        rt = self.get_runtime(bid)
        assert isinstance(rt, DocsBrainRuntime)
        return rt
