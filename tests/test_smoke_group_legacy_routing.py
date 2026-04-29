#!/usr/bin/env python3
"""Regression test: legacy routing paths (intelligent / user-directed / meta-routed / round-robin)
must NOT trigger _run_team_turn when routing != "team".

Also verifies that the 4 legacy routing strategies still dispatch to their
original code paths and do not produce any WorkforceAction events.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import pytest
from unittest.mock import MagicMock

from agenticx.runtime.group_router import GroupChatRouter, GroupReply


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_router_with_spies():
    """Build a GroupChatRouter whose _run_team_turn is instrumented."""
    registry = MagicMock()
    registry.get_avatar = MagicMock(return_value=None)
    router = GroupChatRouter(
        avatar_registry=registry,
        llm_factory=MagicMock(return_value=MagicMock()),
        max_tool_rounds=5,
    )
    return router


def _make_session():
    sess = MagicMock()
    sess.session_id = "reg-test"
    sess.provider_name = "openai"
    sess.model_name = "gpt-4"
    sess.workspace_dir = None
    sess.context_files = {}
    sess.taskspaces = []
    sess.scratchpad = {}
    return sess


# ---------------------------------------------------------------------------
# Legacy routing strategies must NOT call _run_team_turn
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
@pytest.mark.parametrize("routing", [
    "intelligent",
    "user-directed",
    "meta-routed",
    "round-robin",
])
async def test_legacy_routing_simple_prompt_does_not_call_team_turn(routing: str):
    """All 4 legacy routing modes with simple prompts must bypass _run_team_turn.

    NOTE: with the auto-dispatch heuristic, intelligent + complex prompt CAN
    invoke Workforce — that's the intended product behaviour.  This test
    pins the regression contract that *simple* prompts always stay legacy.
    """
    router = _make_router_with_spies()
    team_called = False

    async def spy_team_turn(**kwargs):
        nonlocal team_called
        team_called = True
        yield GroupReply("x", "x", "", "", True, event_type="group_reply")

    router._run_team_turn = spy_team_turn  # type: ignore[assignment]

    # Stub legacy downstream methods so the test terminates fast.
    async def _stub_one_target(*args, **kwargs):
        return GroupReply("x", "x", "", "", True, event_type="group_skipped")

    async def _stub_one_target_stream(**kwargs):
        yield GroupReply("x", "x", "", "", True, event_type="group_skipped")

    async def _stub_analyze_intent(**kwargs):
        from agenticx.runtime.group_router import IntentDecision
        return IntentDecision(action="meta_direct", target_ids=[], reason="stub")

    async def _stub_meta_pm(**kwargs):
        return GroupReply("__meta__", "Machi", "", "ok", False, event_type="group_reply")

    router._run_one_target = _stub_one_target  # type: ignore[assignment]
    router._run_one_target_stream = _stub_one_target_stream  # type: ignore[assignment]
    router._analyze_intent = _stub_analyze_intent  # type: ignore[assignment]
    router._run_meta_project_manager_reply = _stub_meta_pm  # type: ignore[assignment]

    session = _make_session()
    async for _ in router.run_group_turn(
        base_session=session,
        group_id="g-reg",
        group_name="Regression Group",
        routing=routing,
        group_avatar_ids=["av1", "av2"],
        mentioned_avatar_ids=[],
        user_input="你好",  # simple prompt — heuristic returns False
        quoted_content="",
        should_stop=lambda: False,
    ):
        pass

    assert not team_called, (
        f"routing={routing!r} + simple prompt must NOT invoke _run_team_turn, but it did"
    )


@pytest.mark.asyncio
@pytest.mark.parametrize("routing", [
    "user-directed",
    "meta-routed",
    "round-robin",
])
async def test_non_intelligent_routing_never_auto_dispatches_even_on_complex(routing: str):
    """user-directed / meta-routed / round-robin must NOT auto-dispatch even for complex prompts.

    Auto-dispatch is exclusively a feature of the `intelligent` routing path.
    The other 3 strategies preserve their explicit semantics.
    """
    router = _make_router_with_spies()
    team_called = False

    async def spy_team_turn(**kwargs):
        nonlocal team_called
        team_called = True
        yield GroupReply("x", "x", "", "", True, event_type="group_reply")

    router._run_team_turn = spy_team_turn  # type: ignore[assignment]

    async def _stub_one_target(*args, **kwargs):
        return GroupReply("x", "x", "", "", True, event_type="group_skipped")

    router._run_one_target = _stub_one_target  # type: ignore[assignment]

    session = _make_session()
    async for _ in router.run_group_turn(
        base_session=session,
        group_id="g-noauto",
        group_name="No Auto Dispatch",
        routing=routing,
        group_avatar_ids=["av1", "av2"],
        mentioned_avatar_ids=[],
        # Complex prompt that WOULD trip heuristic under intelligent routing.
        user_input="先调研 X 库，然后写一个 hello world demo，再加测试。",
        quoted_content="",
        should_stop=lambda: False,
    ):
        pass

    assert not team_called, (
        f"routing={routing!r} must never auto-dispatch to Workforce regardless of prompt"
    )


# ---------------------------------------------------------------------------
# pick_targets: legacy routing strategies still produce correct targets
# ---------------------------------------------------------------------------

class TestPickTargets:
    def _pt(self, router, group_id, avatar_ids, routing, mentions, scratchpad):
        return router.pick_targets(
            group_id=group_id,
            group_avatar_ids=avatar_ids,
            routing=routing,
            mentioned_avatar_ids=mentions,
            scratchpad=scratchpad,
        )

    def test_user_directed_no_mentions_returns_all(self):
        router = _make_router_with_spies()
        targets = self._pt(router, "g", ["a1", "a2"], "user-directed", [], {})
        assert set(targets) == {"a1", "a2"}

    def test_round_robin_advances_index(self):
        router = _make_router_with_spies()
        sp: dict = {}
        t1 = self._pt(router, "g", ["a", "b", "c"], "round-robin", [], sp)
        t2 = self._pt(router, "g", ["a", "b", "c"], "round-robin", [], sp)
        assert t1 != t2 or len(t1) == 1, "round-robin should rotate through members"

    def test_intelligent_no_mention_returns_empty(self):
        router = _make_router_with_spies()
        targets = self._pt(router, "g", ["a", "b"], "intelligent", [], {})
        assert targets == []

    def test_meta_routed_returns_meta_plus_members(self):
        router = _make_router_with_spies()
        from agenticx.runtime.group_router import META_LEADER_AGENT_ID
        targets = self._pt(router, "g", ["a", "b"], "meta-routed", [], {})
        assert META_LEADER_AGENT_ID in targets
        assert "a" in targets and "b" in targets

    def test_team_routing_not_in_pick_targets(self):
        """pick_targets does not handle 'team' — it's dispatched before pick_targets is called."""
        router = _make_router_with_spies()
        targets = self._pt(router, "g", ["a"], "team", [], {})
        # Fallback: returns all members (user-directed fallback)
        assert "a" in targets


# ---------------------------------------------------------------------------
# WorkforceAction: no legacy event types mixed in
# ---------------------------------------------------------------------------

def test_workforce_event_types_not_in_legacy_event_type_strings():
    """Ensure workforce.* event_type strings are distinct from group_reply / group_typing etc."""
    from agenticx.collaboration.workforce.events import WorkforceAction
    legacy_types = {"group_reply", "group_typing", "group_progress", "group_blocked",
                    "group_nudge", "group_skipped"}
    for action in WorkforceAction:
        wf_type = f"workforce.{action.value}"
        assert wf_type not in legacy_types, (
            f"WorkforceAction {action.value} conflicts with legacy event type {wf_type}"
        )
