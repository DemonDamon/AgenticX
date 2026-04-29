#!/usr/bin/env python3
"""Smoke test: validate WorkforcePattern API shape for group_router bridge.

Verifies that WorkforcePattern, WorkforceEventBus and TaskLock can be
imported and constructed without LLM calls.  Does NOT execute tasks.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import pytest
from unittest.mock import MagicMock

from agenticx.collaboration.workforce.workforce_pattern import WorkforcePattern
from agenticx.collaboration.workforce.events import WorkforceEventBus, WorkforceEvent, WorkforceAction
from agenticx.collaboration.task_lock import TaskLock, get_or_create_task_lock, remove_task_lock
from agenticx.collaboration.workforce.coordinator import CoordinatorAgent
from agenticx.collaboration.workforce.task_planner import TaskPlannerAgent
from agenticx.collaboration.workforce.worker import SingleAgentWorker
from agenticx.core.agent import Agent
from agenticx.core.task import Task
from agenticx.collaboration.enums import CollaborationMode


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_agent(name: str, role: str, goal: str = "Execute tasks") -> Agent:
    """Build a minimal Agent for bridge tests."""
    return Agent(name=name, role=role, goal=goal, organization_id="agenticx-test")


# ---------------------------------------------------------------------------
# API shape verification
# ---------------------------------------------------------------------------

class TestWorkforcePatternAPI:
    """Verify that the API surface used by _run_team_turn exists and is callable."""

    def test_workforce_pattern_constructor_accepts_event_bus(self):
        """WorkforcePattern.__init__ must accept event_bus kwarg."""
        llm_mock = MagicMock()
        coordinator = _make_agent("Leader", "coordinator")
        task_planner = _make_agent("Planner", "task_planner")
        worker1 = _make_agent("Worker1", "researcher")

        event_bus = WorkforceEventBus()

        pattern = WorkforcePattern(
            coordinator_agent=coordinator,
            task_agent=task_planner,
            workers=[worker1],
            llm_provider=llm_mock,
            event_bus=event_bus,
        )
        assert pattern.event_bus is event_bus

    def test_workforce_pattern_has_decompose_task(self):
        """WorkforcePattern must expose decompose_task as an async method."""
        import inspect
        pattern = WorkforcePattern(
            coordinator_agent=_make_agent("Leader", "coordinator"),
            task_agent=_make_agent("Planner", "task_planner"),
            workers=[_make_agent("W", "role")],
            llm_provider=MagicMock(),
        )
        assert inspect.iscoroutinefunction(pattern.decompose_task)

    def test_workforce_pattern_has_start_execution(self):
        """WorkforcePattern must expose start_execution as an async method."""
        import inspect
        pattern = WorkforcePattern(
            coordinator_agent=_make_agent("L", "leader"),
            task_agent=_make_agent("P", "planner"),
            workers=[_make_agent("W", "role")],
            llm_provider=MagicMock(),
        )
        assert inspect.iscoroutinefunction(pattern.start_execution)

    def test_collaboration_mode_workforce_enum_exists(self):
        """CollaborationMode.WORKFORCE must exist (even if not in manager)."""
        assert CollaborationMode.WORKFORCE is not None
        assert CollaborationMode.WORKFORCE.value == "workforce"

    def test_coordinator_assign_tasks_signature(self):
        """CoordinatorAgent.assign_tasks must be an async method accepting (tasks, workers)."""
        import inspect
        coord = CoordinatorAgent(agent=_make_agent("L", "leader"), executor=MagicMock())
        assert inspect.iscoroutinefunction(coord.assign_tasks)


class TestWorkforceEventBusAPI:
    """Verify WorkforceEventBus API used for SSE streaming."""

    def test_event_bus_has_required_methods(self):
        bus = WorkforceEventBus()
        assert callable(bus.subscribe)
        assert callable(bus.publish)
        assert asyncio.iscoroutinefunction(bus.get_next_event)
        assert asyncio.iscoroutinefunction(bus.publish_async)

    def test_event_bus_subscribe_and_publish_sync(self):
        bus = WorkforceEventBus()
        received: list[WorkforceEvent] = []
        bus.subscribe(received.append)

        evt = WorkforceEvent(
            action=WorkforceAction.DECOMPOSE_START,
            task_id="t1",
            data={"task_description": "test"},
        )
        bus.publish(evt)

        assert len(received) == 1
        assert received[0].action == WorkforceAction.DECOMPOSE_START

    @pytest.mark.asyncio
    async def test_event_bus_get_next_event_timeout(self):
        bus = WorkforceEventBus()
        result = await bus.get_next_event(timeout=0.05)
        assert result is None  # nothing published, should timeout

    @pytest.mark.asyncio
    async def test_event_bus_get_next_event_returns_published(self):
        bus = WorkforceEventBus()
        evt = WorkforceEvent(action=WorkforceAction.TASK_ASSIGNED, task_id="t2", data={})
        await bus.publish_async(evt)
        result = await bus.get_next_event(timeout=1.0)
        assert result is not None
        assert result.action == WorkforceAction.TASK_ASSIGNED

    def test_workforce_action_all_required_values_exist(self):
        """Verify all WorkforceAction values referenced in bridge event mapping exist."""
        required = {
            WorkforceAction.DECOMPOSE_START,
            WorkforceAction.DECOMPOSE_PROGRESS,
            WorkforceAction.DECOMPOSE_COMPLETE,
            WorkforceAction.DECOMPOSE_FAILED,
            WorkforceAction.TASK_ASSIGNED,
            WorkforceAction.TASK_STARTED,
            WorkforceAction.TASK_COMPLETED,
            WorkforceAction.TASK_FAILED,
            WorkforceAction.TASK_SKIPPED,
            WorkforceAction.AGENT_ACTIVATED,
            WorkforceAction.AGENT_DEACTIVATED,
            WorkforceAction.USER_MESSAGE,
            WorkforceAction.ASSISTANT_MESSAGE,
            WorkforceAction.WORKFORCE_STARTED,
            WorkforceAction.WORKFORCE_STOPPED,
            WorkforceAction.WORKFORCE_PAUSED,
            WorkforceAction.WORKFORCE_RESUMED,
        }
        from agenticx.collaboration.workforce.events import WorkforceAction as WA
        for action in required:
            assert action in WA, f"Missing WorkforceAction: {action}"


class TestTaskLockAPI:
    """Verify TaskLock API used for group session state."""

    def test_get_or_create_task_lock(self):
        pid = "group::test-group::test-session"
        try:
            lock = get_or_create_task_lock(pid)
            assert lock is not None
            assert lock.id == pid

            # Same project_id returns same instance
            lock2 = get_or_create_task_lock(pid)
            assert lock is lock2
        finally:
            remove_task_lock(pid)

    def test_task_lock_has_required_api(self):
        pid = "group::test-group2::test-session"
        try:
            lock = get_or_create_task_lock(pid)
            # Action queue
            assert asyncio.iscoroutinefunction(lock.put_queue)
            assert asyncio.iscoroutinefunction(lock.get_queue)
            # Conversation history
            assert callable(lock.add_conversation)
            assert callable(lock.get_conversation_history)
            # Status
            assert callable(lock.set_status)
        finally:
            remove_task_lock(pid)

    @pytest.mark.asyncio
    async def test_task_lock_project_id_isolation(self):
        """Different project_ids must return different TaskLock instances."""
        pid_a = "group::g1::s1"
        pid_b = "group::g2::s1"
        try:
            lock_a = get_or_create_task_lock(pid_a)
            lock_b = get_or_create_task_lock(pid_b)
            assert lock_a is not lock_b
        finally:
            remove_task_lock(pid_a)
            remove_task_lock(pid_b)


class TestTaskCreation:
    """Verify Task can be constructed for use in bridge."""

    def test_task_construction(self):
        task = Task(description="调研 X 库然后写 demo", expected_output="demo code")
        assert task.id is not None
        assert task.description == "调研 X 库然后写 demo"
