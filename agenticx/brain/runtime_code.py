"""Code brain runtime — one codebase per brain."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional

from agenticx.code_index.backends.base import CodeSearchHit
from agenticx.code_index.config import CodeIndexConfig
from agenticx.code_index.manager import CodeIndexManager

from .registry import BrainRegistry
from .types import Brain, CodeBrainConfig


class CodeBrainRuntime:
    def __init__(self, brain: Brain) -> None:
        self.brain = brain
        self._cfg = brain.code_config()
        self._manager = CodeIndexManager.instance()

    def codebase_path(self) -> Path:
        raw = str(self._cfg.codebase_path or "").strip()
        if not raw:
            raise ValueError(
                "codebase_path 未配置：请先在设置中填写代码库绝对路径并点击「保存配置」"
            )
        p = Path(raw).expanduser()
        if not p.is_absolute():
            raise ValueError(
                f"codebase_path 必须是绝对路径（以 / 开头），当前值: {raw!r}"
            )
        return p.resolve()

    def _code_index_config(self) -> CodeIndexConfig:
        return CodeIndexConfig(
            enabled=self._cfg.enabled and self.brain.enabled,
            backend=self._cfg.backend,
            preload_model=self._cfg.preload_model,
            max_index_memory_mb=self._cfg.max_index_memory_mb,
            semble_search_mode=self._cfg.search_mode,
            semble_default_top_k=self._cfg.default_top_k,
            semble_include_text_files=self._cfg.include_text_files,
            semble_model=self._cfg.model,
        )

    def search(self, query: str, *, top_k: Optional[int] = None) -> List[CodeSearchHit]:
        if not self.brain.enabled or not self._cfg.enabled:
            return []
        path = self.codebase_path()
        k = top_k if top_k is not None else self._cfg.default_top_k
        hits, _indexing, _progress = self._manager.search(
            path,
            query,
            top_k=k,
            strategy=self._cfg.search_mode,
            config=self._code_index_config(),
        )
        return hits

    def create_index(self) -> Dict[str, Any]:
        path = self.codebase_path()
        return self._manager.create_index(path, config=self._code_index_config())

    def status(self) -> Dict[str, Any]:
        path = self.codebase_path()
        return self._manager.get_status(path)

    def clear_index(self) -> None:
        self._manager.clear(self.codebase_path())

    def cancel_index(self) -> None:
        self._manager.cancel(self.codebase_path())

    def update_config(self, patch: Dict[str, Any]) -> CodeBrainConfig:
        merged = {**self._cfg.to_dict(), **patch}
        cfg = CodeBrainConfig.from_dict(merged)
        BrainRegistry.instance().update(
            self.brain.id,
            {"config": cfg.to_dict(), "enabled": self.brain.enabled},
        )
        refreshed = BrainRegistry.instance().get(self.brain.id)
        if refreshed is not None:
            self.brain = refreshed
            self._cfg = refreshed.code_config()
        return self._cfg
