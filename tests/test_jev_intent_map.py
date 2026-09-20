#!/usr/bin/env python3
"""Tests for Jev group-routing question schema and response mapping.

Author: Damon Li
"""

from __future__ import annotations

from agenticx.runtime.jev_intent import (
    ACTION_CRITERIA,
    JEV_ACTION_CHOICES,
    JevIntentMap,
    build_group_routing_questions,
    build_group_routing_state,
    map_jev_to_intent,
    member_role_snippet,
)


def _answers(*, action: str, confidence: float, target: str, noul: float, probs: dict | None = None) -> dict:
    return {
        "model": "jev-1.13.0",
        "answers": {
            "action": {
                "type": "choice",
                "choice": action,
                "confidence": confidence,
                "probabilities": probs
                or {
                    "route_to": 0.81,
                    "meta_direct": 0.12,
                    "continue_thread": 0.05,
                    "open_floor": 0.02,
                },
            },
            "target": {
                "type": "choice",
                "choice": target,
                "confidence": 0.9,
                "probabilities": {target: 1.0},
            },
            "requires_execution": {"type": "noul", "noul": noul},
        },
    }


def test_build_questions_include_meta_and_none() -> None:
    members = [
        {"id": "__meta__", "name": "Near", "role": "项目经理"},
        {"id": "fin", "name": "财务", "role": "对账单与报销"},
    ]
    questions = build_group_routing_questions(members)
    assert set(questions) == {"action", "target", "requires_execution"}
    assert questions["action"]["type"] == "choice"
    assert set(questions["action"]["criteria"]) == set(JEV_ACTION_CHOICES)
    for key in ACTION_CRITERIA:
        assert questions["action"]["criteria"][key] == ACTION_CRITERIA[key]
    assert questions["target"]["criteria"]["fin"].startswith("财务:")
    assert "none" in questions["target"]["criteria"]
    assert "__meta__" in questions["target"]["criteria"]
    assert questions["requires_execution"]["type"] == "noul"


def test_member_role_truncated_to_80() -> None:
    snippet = member_role_snippet("财务", "x" * 200)
    assert len(snippet) == 80


def test_choice_criteria_capped_at_255() -> None:
    members = [{"id": "a1", "name": "A", "role": "y" * 400}]
    questions = build_group_routing_questions(members)
    assert len(questions["target"]["criteria"]["a1"]) <= 255


def test_build_state_shape() -> None:
    state = build_group_routing_state(
        group_name="财务组",
        members=[{"id": "fin", "name": "财务", "role": "对账"}],
        active_thread="fin(fin), turn_count=2, last_topic=对账",
        recent_dialogue="- 用户: hi",
        user_message="看下对账单",
    )
    assert state["group_name"] == "财务组"
    assert state["members"][0]["id"] == "fin"
    assert state["active_thread"].startswith("fin")
    assert state["recent_dialogue"] == "- 用户: hi"
    assert state["user_message"] == "看下对账单"


def test_route_to_valid_id_auto() -> None:
    mapped = map_jev_to_intent(
        _answers(action="route_to", confidence=0.9, target="a1", noul=0.91),
        member_ids={"a1", "a2"},
        user_input="帮财务看对账单",
        act_above=0.8,
        review_above=0.5,
    )
    assert mapped.ok is True
    assert mapped.gate == "auto"
    assert mapped.action == "route_to"
    assert mapped.target_ids == ["a1"]
    assert mapped.requires_execution is True
    assert mapped.reason == "jev"
    assert mapped.confidence == 0.9
    assert mapped.model == "jev-1.13.0"
    assert mapped.noul_execution == 0.91


def test_route_to_none_becomes_meta_direct() -> None:
    mapped = map_jev_to_intent(
        _answers(action="route_to", confidence=0.85, target="none", noul=0.1),
        member_ids={"a1"},
        user_input="大家好",
        act_above=0.8,
        review_above=0.5,
    )
    assert mapped.ok is True
    assert mapped.action == "meta_direct"
    assert mapped.target_ids == []
    assert mapped.requires_execution is False


def test_route_to_illegal_target_becomes_meta_direct() -> None:
    mapped = map_jev_to_intent(
        _answers(action="route_to", confidence=0.85, target="ghost", noul=0.2),
        member_ids={"a1"},
        user_input="闲聊",
        act_above=0.8,
        review_above=0.5,
    )
    assert mapped.action == "meta_direct"
    assert mapped.target_ids == []


def test_illegal_action_not_ok() -> None:
    mapped = map_jev_to_intent(
        _answers(action="explode", confidence=0.99, target="a1", noul=0.9),
        member_ids={"a1"},
        user_input="x",
        act_above=0.8,
        review_above=0.5,
    )
    assert mapped.ok is False
    assert mapped.fallback_reason


def test_abstain_below_review() -> None:
    mapped = map_jev_to_intent(
        _answers(action="route_to", confidence=0.2, target="a1", noul=0.9),
        member_ids={"a1"},
        user_input="查仓库",
        act_above=0.8,
        review_above=0.5,
    )
    assert mapped.ok is True
    assert mapped.gate == "abstain"
    assert mapped.reason == "jev"


def test_review_band() -> None:
    mapped = map_jev_to_intent(
        _answers(action="route_to", confidence=0.6, target="a1", noul=0.8),
        member_ids={"a1"},
        user_input="查仓库",
        act_above=0.8,
        review_above=0.5,
    )
    assert mapped.gate == "review"
    assert mapped.reason == "jev_review"
    assert mapped.action == "route_to"
    assert mapped.target_ids == ["a1"]


def test_noul_middle_uses_heuristic() -> None:
    exec_mapped = map_jev_to_intent(
        _answers(action="open_floor", confidence=0.9, target="none", noul=0.5),
        member_ids={"a1"},
        user_input="查仓库并修复这个 bug",
        act_above=0.8,
        review_above=0.5,
    )
    chat_mapped = map_jev_to_intent(
        _answers(action="open_floor", confidence=0.9, target="none", noul=0.5),
        member_ids={"a1"},
        user_input="进度如何",
        act_above=0.8,
        review_above=0.5,
    )
    assert exec_mapped.requires_execution is True
    assert chat_mapped.requires_execution is False


def test_continue_thread_and_open_floor() -> None:
    cont = map_jev_to_intent(
        _answers(action="continue_thread", confidence=0.88, target="a1", noul=0.2),
        member_ids={"a1"},
        user_input="那然后呢",
        act_above=0.8,
        review_above=0.5,
    )
    floor = map_jev_to_intent(
        _answers(action="open_floor", confidence=0.88, target="none", noul=0.1),
        member_ids={"a1"},
        user_input="哈哈",
        act_above=0.8,
        review_above=0.5,
    )
    assert cont.action == "continue_thread"
    assert floor.action == "open_floor"
    assert floor.target_ids == []
