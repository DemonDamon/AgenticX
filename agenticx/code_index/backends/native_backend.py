"""Placeholder native backend (2026-05-06 plan)."""

from __future__ import annotations

from pathlib import Path
from typing import Callable, Optional, Sequence

from .base import CodeIndexBackend, CodeSearchHit


class NativeCodeIndexBackend:
    name = "native"

    def build(
        self,
        codebase_path: Path,
        *,
        on_progress: Callable[[int, int], None],
        cancel_event: Optional[object] = None,
        include_text_files: bool = False,
    ) -> None:
        raise NotImplementedError(
            "native code_index backend 尚未实现；请在 ~/.agenticx/config.yaml 将 "
            "code_index.backend 设为 semble，并安装 agenticx[code_index]。"
        )

    def search(self, query: str, top_k: int, strategy: str) -> Sequence[CodeSearchHit]:
        raise NotImplementedError("native code_index backend 尚未实现")

    def clear(self) -> None:
        pass

    def find_related(self, file_path: str, line: int, top_k: int) -> Sequence[CodeSearchHit]:
        raise NotImplementedError("native code_index backend 尚未实现")

    @property
    def stats(self) -> dict:
        return {}
