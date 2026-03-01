#!/usr/bin/env python3
"""Smoke tests for execution lane generation counter.

Author: Damon Li
"""

import asyncio

from agenticx.core.execution_lane import ExecutionLane


class TestGenerationCounter:
    def test_reset_increments_generation(self):
        lane = ExecutionLane()
        g1 = lane.generation
        g2 = lane.reset()
        assert g2 == g1 + 1
        assert lane.generation == g2

    def test_stale_release_is_ignored(self):
        lane = ExecutionLane()

        async def _acquire():
            return await lane.acquire("s1")

        guard = asyncio.run(_acquire())
        stale_generation = lane.generation
        lane.reset()

        # stale release should not affect the new generation lock map
        lane.release("s1", generation=stale_generation)
        assert not lane.is_session_locked("s1")

        async def _reacquire():
            g2 = await lane.acquire("s1")
            lane.release("s1", generation=lane.generation)
            return g2

        asyncio.run(_reacquire())

    def test_release_without_generation_still_works(self):
        lane = ExecutionLane()

        async def _run():
            guard = await lane.acquire("s2")
            assert lane.is_session_locked("s2")
            lane.release("s2")
            assert not lane.is_session_locked("s2")
            return guard

        asyncio.run(_run())

    def test_stale_release_does_not_leak_global_slot(self):
        lane = ExecutionLane(max_concurrent=1)

        async def _acquire_guard():
            return await lane.acquire("s1")

        guard = asyncio.run(_acquire_guard())
        stale_generation = lane.generation
        lane.reset()
        lane.release("s1", generation=stale_generation)

        async def _acquire_after_stale_release():
            g = await lane.acquire("s2")
            lane.release("s2", generation=lane.generation)
            return g

        # If stale release leaked semaphore slot, this acquire would block forever.
        asyncio.run(_acquire_after_stale_release())
