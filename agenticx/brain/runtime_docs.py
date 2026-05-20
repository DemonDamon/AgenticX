"""Docs brain runtime — wraps KBRuntime per brain instance."""

from __future__ import annotations

from typing import Any, Dict, List

from agenticx.studio.kb.contracts import KBConfig, RetrievalHit
from agenticx.studio.kb.jobs import JobRegistry
from agenticx.studio.kb.runtime import KBRuntime

from .registry import BrainRegistry
from .types import Brain


class DocsBrainRuntime:
    def __init__(self, brain: Brain) -> None:
        self.brain = brain
        self._registry_dir = BrainRegistry.instance().kb_registry_dir_for(brain)
        cfg = brain.docs_config()
        self._runtime = KBRuntime(cfg, registry_dir=self._registry_dir)
        self._jobs = JobRegistry(max_workers=2)

    @property
    def runtime(self) -> KBRuntime:
        return self._runtime

    @property
    def jobs(self) -> JobRegistry:
        return self._jobs

    def read_config(self) -> KBConfig:
        return self._runtime.config

    def write_config(self, new_config: KBConfig) -> Dict[str, Any]:
        result = self._runtime.update_config(new_config)
        reg = BrainRegistry.instance()
        reg.update(self.brain.id, {"config": new_config.to_dict(), "enabled": new_config.enabled})
        refreshed = reg.get(self.brain.id)
        if refreshed is not None:
            self.brain = refreshed
        return result

    def search(self, query: str, *, top_k: int = 5) -> List[RetrievalHit]:
        return self._runtime.search(query, top_k=top_k)

    def stats(self) -> Dict[str, Any]:
        return self._runtime.stats()

    def refresh_brain_stats(self) -> None:
        s = self.stats()
        BrainRegistry.instance().update(
            self.brain.id,
            {
                "stats": {
                    "doc_count": s.get("doc_count", 0),
                    "indexed_doc_count": s.get("indexed_doc_count", 0),
                    "failed_doc_count": s.get("failed_doc_count", 0),
                    "chunk_count": s.get("chunk_count", 0),
                    "rebuild_required": s.get("rebuild_required", False),
                }
            },
        )
