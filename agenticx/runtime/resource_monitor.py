#!/usr/bin/env python3
"""System resource monitor for Agent Team scheduling."""

from __future__ import annotations

import os
from typing import Any, Dict


class ResourceMonitor:
    """Collect lightweight host stats and decide whether spawning is safe."""

    def __init__(
        self,
        *,
        max_cpu_percent: float = 98.0,
        max_memory_percent: float = 98.0,
    ) -> None:
        self.max_cpu_percent = max_cpu_percent
        self.max_memory_percent = max_memory_percent

    def _cpu_percent_estimate(self) -> float:
        # Prefer psutil for a more realistic instantaneous CPU reading.
        try:
            import psutil  # type: ignore

            return float(psutil.cpu_percent(interval=0.2))
        except Exception:
            pass

        cpu_count = max(os.cpu_count() or 1, 1)
        try:
            load_1m = os.getloadavg()[0]
            return max(0.0, min(100.0, (load_1m / cpu_count) * 100.0))
        except (AttributeError, OSError):
            return 0.0

    def _memory_percent(self) -> float:
        # Prefer psutil when available; fallback keeps this optional.
        try:
            import psutil  # type: ignore

            return float(psutil.virtual_memory().percent)
        except Exception:
            return 0.0

    def get_system_stats(self, *, active_subagents: int = 0) -> Dict[str, Any]:
        cpu_percent = round(self._cpu_percent_estimate(), 2)
        memory_percent = round(self._memory_percent(), 2)
        return {
            "cpu_percent": cpu_percent,
            "memory_percent": memory_percent,
            "active_subagents": int(active_subagents),
        }

    def can_spawn(self, *, active_subagents: int = 0) -> Dict[str, Any]:
        stats = self.get_system_stats(active_subagents=active_subagents)
        cpu_ok = stats["cpu_percent"] <= self.max_cpu_percent
        mem_ok = stats["memory_percent"] <= self.max_memory_percent
        allowed = bool(cpu_ok and mem_ok)
        reasons = []
        if not cpu_ok:
            reasons.append(
                f"CPU 使用率过高 ({stats['cpu_percent']}% > {self.max_cpu_percent}%)"
            )
        if not mem_ok:
            reasons.append(
                f"内存使用率过高 ({stats['memory_percent']}% > {self.max_memory_percent}%)"
            )
        return {
            "allowed": allowed,
            "reasons": reasons,
            "stats": stats,
        }
