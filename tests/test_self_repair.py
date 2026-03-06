#!/usr/bin/env python3
"""Tests for self-repair system.

Author: Damon Li
"""

import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock
from agenticx.core.self_repair import (
    SelfRepair,
    DefaultSelfRepair,
    SelfRepairConfig,
    RepairResult,
    StuckTask,
    BrokenTool,
)


class TestSelfRepairConfig:
    def test_default_config(self):
        config = SelfRepairConfig()
        assert config.check_interval == 60.0
        assert config.max_repair_attempts == 3
        assert config.stuck_threshold == 300.0


class TestDefaultSelfRepair:
    @pytest.mark.asyncio
    async def test_detect_stuck_returns_empty_by_default(self):
        repair = DefaultSelfRepair(config=SelfRepairConfig())
        stuck = await repair.detect_stuck_tasks()
        assert stuck == []

    @pytest.mark.asyncio
    async def test_repair_stuck_respects_max_attempts(self):
        repair = DefaultSelfRepair(config=SelfRepairConfig(max_repair_attempts=2))
        task = StuckTask(task_id="t1", repair_attempts=3)
        result = await repair.repair_stuck_task(task)
        assert result == RepairResult.MANUAL_REQUIRED

    @pytest.mark.asyncio
    async def test_repair_stuck_attempts_recovery(self):
        repair = DefaultSelfRepair(config=SelfRepairConfig())
        task = StuckTask(task_id="t1", repair_attempts=0)
        result = await repair.repair_stuck_task(task)
        assert result in (RepairResult.SUCCESS, RepairResult.RETRY)

    @pytest.mark.asyncio
    async def test_detect_broken_tools_returns_empty_by_default(self):
        repair = DefaultSelfRepair(config=SelfRepairConfig())
        broken = await repair.detect_broken_tools()
        assert broken == []

    @pytest.mark.asyncio
    async def test_repair_broken_tool_respects_max_attempts(self):
        repair = DefaultSelfRepair(config=SelfRepairConfig(max_repair_attempts=2))
        tool = BrokenTool(name="bad_tool", failure_count=10, repair_attempts=3)
        result = await repair.repair_broken_tool(tool)
        assert result == RepairResult.MANUAL_REQUIRED
