#!/usr/bin/env python3
"""Backend protocol that a rollout implementation must satisfy.

Author: Hongyi Zhao
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any, Protocol

if TYPE_CHECKING:
    import numpy as np

    from .models import SessionCreate

EventCallback = Callable[[str, dict[str, Any]], None]


@dataclass
class PoseCheck:
    context: str
    verified: bool | None
    max_abs_err: float | None
    tolerance: float
    error: str | None = None


class RolloutBackend(Protocol):
    def load(self, spec: SessionCreate, on_event: EventCallback) -> None:
        """Block until the policy and robot are ready and idle; raise BridgeError on failure.

        Before returning, the backend must already run its own serve thread. Events are
        delivered through ``on_event`` from that thread.
        """
        ...

    def start(self) -> bool: ...

    def set_task(self, task: str) -> bool: ...

    def reset(self) -> bool: ...

    def stop_and_teardown(self, tolerance: float) -> PoseCheck:
        """Stop the serve loop, return home, verify the pose, release hardware. Idempotent."""
        ...

    def verify_pose(self, context: str, tolerance: float) -> PoseCheck: ...

    def read_frame(self, camera: str | None) -> tuple[str, np.ndarray]:
        """Return ``(camera_name, HxWx3 uint8 RGB frame)``."""
        ...

    @property
    def task(self) -> str: ...

    @property
    def initial_task(self) -> str: ...

    @property
    def failure_traceback(self) -> str | None: ...

    @property
    def camera_names(self) -> list[str]: ...

    @property
    def supports_text_queries(self) -> bool: ...
