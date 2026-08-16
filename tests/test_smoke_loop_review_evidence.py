#!/usr/bin/env python3
"""Smoke tests for agenticx.learning.evidence (AC-1)."""

from agenticx.learning.evidence import (
    EvidenceState,
    cap_score,
    classify_delivery_evidence,
    classify_validation_evidence,
    collect_session_evidence,
)


def test_collect_empty_observations():
    ev = collect_session_evidence([])
    assert ev.verification_calls == 0
    assert ev.verification_success == 0
    assert ev.write_calls == 0
    assert ev.user_turns == 0
    assert ev.observations_available is False


def test_pytest_result_counts_as_outcome_supported():
    obs = [
        {"tool_name": "bash_exec", "result_summary": "pytest: 5 passed in 1.2s", "success": True},
    ]
    ev = collect_session_evidence(obs)
    assert ev.verification_calls == 1
    assert ev.verification_success == 1
    assert classify_validation_evidence(ev) is EvidenceState.OUTCOME_SUPPORTED


def test_write_only_session_is_present():
    obs = [{"tool_name": "file_write", "success": True}]
    ev = collect_session_evidence(obs)
    assert ev.write_calls == 1
    assert ev.verification_calls == 0
    assert classify_validation_evidence(ev) is EvidenceState.PRESENT


def test_read_only_session_is_not_applicable():
    obs = [{"tool_name": "file_read", "success": True}]
    ev = collect_session_evidence(obs)
    assert classify_validation_evidence(ev) is EvidenceState.NOT_APPLICABLE


def test_bash_without_verification_signature_not_counted():
    obs = [{"tool_name": "bash_exec", "result_summary": "total 42\ndrwxr-xr-x", "success": True}]
    ev = collect_session_evidence(obs)
    assert ev.verification_calls == 0


def test_cap_score():
    assert cap_score(95, EvidenceState.PRESENT) == 55
    assert cap_score(30, EvidenceState.OUTCOME_SUPPORTED) == 30
    assert cap_score(10, EvidenceState.MISSING) == 10


def test_delivery_requires_two_clean_user_turns():
    obs = [{"tool_name": "bash_exec", "result_summary": "pytest: 3 passed", "success": True}]
    msgs = [
        {"role": "user", "content": "帮我修一下这个测试"},
        {"role": "assistant", "content": "..."},
        {"role": "user", "content": "好的，谢谢"},
    ]
    ev = collect_session_evidence(obs, msgs)
    assert ev.user_turns == 2
    assert ev.user_correction_turns == 0
    assert classify_delivery_evidence(ev) is EvidenceState.OUTCOME_SUPPORTED

    msgs_bad = msgs + [{"role": "user", "content": "不对，回退重来"}]
    ev_bad = collect_session_evidence(obs, msgs_bad)
    assert ev_bad.user_correction_turns == 1
    assert classify_delivery_evidence(ev_bad) is EvidenceState.WIRED


def test_delivery_unobserved_without_messages():
    obs = [{"tool_name": "file_read", "success": True}]
    ev = collect_session_evidence(obs, None)
    assert ev.messages_available is False
    assert classify_delivery_evidence(ev) is EvidenceState.UNOBSERVED


def test_extract_signals_reports_validation_evidence():
    """FR-2 (AC-2): analyzer signals carry the new evidence fields."""
    from agenticx.learning.analyzer import extract_signals

    signals = extract_signals([{"tool_name": "file_write", "success": True}])
    assert signals.validation_evidence == "present"
    assert signals.write_calls == 1

    signals_v = extract_signals(
        [{"tool_name": "bash_exec", "result_summary": "pytest: 5 passed", "success": True}]
    )
    assert signals_v.validation_evidence == "outcome_supported"
    assert signals_v.verification_success == 1
