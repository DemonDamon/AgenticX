#!/usr/bin/env python3
"""Smoke tests for subagent spawn limits.

Author: Damon Li
"""

import pytest

from agenticx.core.handoff import HandoffCycleError, HandoffLimitError, check_handoff_cycle


class TestSubagentLimits:
    def test_depth_limit_rejects_excessive_chain(self):
        with pytest.raises(HandoffLimitError):
            check_handoff_cycle(
                target_agent_id="a3",
                handoff_chain=["a1", "a2"],
                max_spawn_depth=2,
            )

    def test_children_limit_rejects_excessive_children(self):
        with pytest.raises(HandoffLimitError):
            check_handoff_cycle(
                target_agent_id="a2",
                handoff_chain=["a1"],
                max_children_per_agent=2,
                current_children_count=2,
            )

    def test_cycle_still_detected(self):
        with pytest.raises(HandoffCycleError):
            check_handoff_cycle(
                target_agent_id="a1",
                handoff_chain=["a1", "a2"],
                max_spawn_depth=5,
            )

    def test_valid_boundary_passes(self):
        check_handoff_cycle(
            target_agent_id="a2",
            handoff_chain=["a1"],
            max_spawn_depth=2,
            max_children_per_agent=2,
            current_children_count=1,
        )
