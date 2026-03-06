#!/usr/bin/env python3
"""Self-repair system for automatic recovery of stuck tasks and broken tools.

Periodically detects anomalous states (stuck jobs, broken tools) and
attempts automatic recovery with configurable limits.

Internalized from IronClaw src/agent/self_repair.rs.

Author: Damon Li
"""

import asyncio
import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass
from enum import Enum
from typing import Optional, Callable, Awaitable

logger = logging.getLogger(__name__)


class RepairResult(Enum):
    SUCCESS = "success"
    RETRY = "retry"
    FAILED = "failed"
    MANUAL_REQUIRED = "manual_required"


@dataclass
class SelfRepairConfig:
    check_interval: float = 60.0
    max_repair_attempts: int = 3
    stuck_threshold: float = 300.0
    broken_tool_failure_threshold: int = 5


@dataclass
class StuckTask:
    task_id: str
    last_activity: Optional[float] = None
    stuck_duration: float = 0.0
    last_error: Optional[str] = None
    repair_attempts: int = 0


@dataclass
class BrokenTool:
    name: str
    failure_count: int = 0
    last_error: Optional[str] = None
    repair_attempts: int = 0


class SelfRepair(ABC):
    """Abstract interface for self-repair implementations."""

    @abstractmethod
    async def detect_stuck_tasks(self) -> list[StuckTask]:
        ...

    @abstractmethod
    async def repair_stuck_task(self, task: StuckTask) -> RepairResult:
        ...

    @abstractmethod
    async def detect_broken_tools(self) -> list[BrokenTool]:
        ...

    @abstractmethod
    async def repair_broken_tool(self, tool: BrokenTool) -> RepairResult:
        ...


class DefaultSelfRepair(SelfRepair):
    """Default self-repair implementation with configurable limits."""

    def __init__(
        self,
        config: Optional[SelfRepairConfig] = None,
        task_detector: Optional[Callable[[], Awaitable[list[StuckTask]]]] = None,
        tool_detector: Optional[Callable[[], Awaitable[list[BrokenTool]]]] = None,
        task_recoverer: Optional[Callable[[StuckTask], Awaitable[bool]]] = None,
        tool_rebuilder: Optional[Callable[[BrokenTool], Awaitable[bool]]] = None,
        on_manual_required: Optional[Callable[[str], Awaitable[None]]] = None,
    ):
        self.config = config or SelfRepairConfig()
        self._task_detector = task_detector
        self._tool_detector = tool_detector
        self._task_recoverer = task_recoverer
        self._tool_rebuilder = tool_rebuilder
        self._on_manual_required = on_manual_required

    async def detect_stuck_tasks(self) -> list[StuckTask]:
        if self._task_detector:
            return await self._task_detector()
        return []

    async def repair_stuck_task(self, task: StuckTask) -> RepairResult:
        if task.repair_attempts >= self.config.max_repair_attempts:
            logger.warning("Task %s exceeded max repair attempts", task.task_id)
            if self._on_manual_required:
                await self._on_manual_required(f"Task {task.task_id} needs manual intervention")
            return RepairResult.MANUAL_REQUIRED

        if self._task_recoverer:
            try:
                success = await self._task_recoverer(task)
                return RepairResult.SUCCESS if success else RepairResult.RETRY
            except Exception as e:
                logger.error("Failed to repair task %s: %s", task.task_id, e)
                return RepairResult.FAILED

        return RepairResult.RETRY

    async def detect_broken_tools(self) -> list[BrokenTool]:
        if self._tool_detector:
            return await self._tool_detector()
        return []

    async def repair_broken_tool(self, tool: BrokenTool) -> RepairResult:
        if tool.repair_attempts >= self.config.max_repair_attempts:
            logger.warning("Tool %s exceeded max repair attempts", tool.name)
            if self._on_manual_required:
                await self._on_manual_required(f"Tool {tool.name} needs manual intervention")
            return RepairResult.MANUAL_REQUIRED

        if self._tool_rebuilder:
            try:
                success = await self._tool_rebuilder(tool)
                return RepairResult.SUCCESS if success else RepairResult.RETRY
            except Exception as e:
                logger.error("Failed to repair tool %s: %s", tool.name, e)
                return RepairResult.FAILED

        return RepairResult.RETRY

    async def run_check_cycle(self) -> dict:
        """Run one check cycle: detect and repair stuck tasks and broken tools."""
        results = {"stuck_tasks": [], "broken_tools": []}

        stuck = await self.detect_stuck_tasks()
        for task in stuck:
            result = await self.repair_stuck_task(task)
            results["stuck_tasks"].append({"task_id": task.task_id, "result": result.value})

        broken = await self.detect_broken_tools()
        for tool in broken:
            result = await self.repair_broken_tool(tool)
            results["broken_tools"].append({"tool_name": tool.name, "result": result.value})

        return results
