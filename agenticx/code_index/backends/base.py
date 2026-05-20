"""Backend protocol for code indexing."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional, Protocol, Sequence


@dataclass(frozen=True)
class CodeSearchHit:
    file_path: str
    start_line: int
    end_line: int
    language: str | None
    score: float
    snippet: str
    backend: str = "semble"


class CodeIndexBackend(Protocol):
    name: str

    def build(
        self,
        codebase_path: Path,
        *,
        on_progress: Callable[[int, int], None],
        cancel_event: Optional[object] = None,
        include_text_files: bool = False,
    ) -> None: ...

    def search(self, query: str, top_k: int, strategy: str) -> Sequence[CodeSearchHit]: ...

    def clear(self) -> None: ...

    def find_related(self, file_path: str, line: int, top_k: int) -> Sequence[CodeSearchHit]: ...

    @property
    def stats(self) -> dict: ...
