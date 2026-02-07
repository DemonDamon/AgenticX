"""
Smoke tests for ExecutionLane (per-session serialization).

Inspired by OpenClaw's server-lanes.ts.
Validates:
- Same-session runs are serialized (no interleaving)
- Different-session runs can execute in parallel
- Optional global concurrency limit is respected
- Disabled lane (None) does not change behaviour
"""

import asyncio
import time
import pytest

from agenticx.core.execution_lane import ExecutionLane, ExecutionLaneGuard


# ---------------------------------------------------------------------------
# Helper: simulate an agent run that records its start/end timestamps
# ---------------------------------------------------------------------------

async def _simulated_run(
    lane: ExecutionLane,
    session_key: str,
    duration: float,
    log: list,
):
    """Acquire the lane, sleep for *duration*, record timing."""
    guard = await lane.acquire(session_key)
    async with guard:
        start = time.monotonic()
        log.append(("start", session_key, start))
        await asyncio.sleep(duration)
        end = time.monotonic()
        log.append(("end", session_key, end))


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

class TestExecutionLane:
    """Unit / smoke tests for the ExecutionLane mechanism."""

    def test_same_session_serial(self):
        """Two concurrent runs on the SAME session must be serialized."""
        lane = ExecutionLane()
        log: list = []

        async def _run():
            await asyncio.gather(
                _simulated_run(lane, "s1", 0.05, log),
                _simulated_run(lane, "s1", 0.05, log),
            )

        asyncio.run(_run())

        # Extract start/end events for session s1
        starts = [t for kind, key, t in log if kind == "start" and key == "s1"]
        ends = [t for kind, key, t in log if kind == "end" and key == "s1"]

        assert len(starts) == 2
        assert len(ends) == 2

        # The second run must start AFTER the first run ends → serialized
        # Sort to get chronological order
        starts.sort()
        ends.sort()
        assert starts[1] >= ends[0], (
            "Second run started before first run ended — not serialized!"
        )

    def test_different_sessions_parallel(self):
        """Runs on DIFFERENT sessions may overlap."""
        lane = ExecutionLane()
        log: list = []

        async def _run():
            await asyncio.gather(
                _simulated_run(lane, "s1", 0.05, log),
                _simulated_run(lane, "s2", 0.05, log),
            )

        asyncio.run(_run())

        s1_start = next(t for kind, key, t in log if kind == "start" and key == "s1")
        s2_start = next(t for kind, key, t in log if kind == "start" and key == "s2")
        s1_end = next(t for kind, key, t in log if kind == "end" and key == "s1")
        s2_end = next(t for kind, key, t in log if kind == "end" and key == "s2")

        # Both should start roughly at the same time (overlap)
        assert abs(s1_start - s2_start) < 0.04, (
            "Different sessions should start in parallel"
        )

    def test_global_lane_limit(self):
        """Global max_concurrent limits total active runs."""
        lane = ExecutionLane(max_concurrent=1)
        log: list = []

        async def _run():
            await asyncio.gather(
                _simulated_run(lane, "s1", 0.05, log),
                _simulated_run(lane, "s2", 0.05, log),
            )

        asyncio.run(_run())

        starts = sorted(t for kind, _, t in log if kind == "start")
        ends = sorted(t for kind, _, t in log if kind == "end")

        # With max_concurrent=1, second start must be after first end
        assert starts[1] >= ends[0], (
            "Global lane limit not enforced — second run started before first ended"
        )

    def test_lane_guard_context_manager(self):
        """ExecutionLaneGuard releases on exit."""
        lane = ExecutionLane()

        async def _run():
            guard = await lane.acquire("s1")
            assert lane.is_session_locked("s1")
            async with guard:
                assert lane.is_session_locked("s1")
            # After exiting the context manager, lock should be released
            assert not lane.is_session_locked("s1")

        asyncio.run(_run())

    def test_introspection_helpers(self):
        """active_sessions and is_session_locked report correct state."""
        lane = ExecutionLane(max_concurrent=5)

        async def _run():
            assert lane.active_sessions == 0
            guard = await lane.acquire("s1")
            assert lane.active_sessions == 1
            assert lane.is_session_locked("s1")
            assert not lane.is_session_locked("s2")
            lane.release("s1")
            assert lane.active_sessions == 0

        asyncio.run(_run())

    def test_max_concurrent_property(self):
        lane_none = ExecutionLane()
        assert lane_none.max_concurrent is None

        lane_3 = ExecutionLane(max_concurrent=3)
        assert lane_3.max_concurrent == 3


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
