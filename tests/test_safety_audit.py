#!/usr/bin/env python3
"""Tests for structured safety audit event log.

Author: Damon Li
"""

import pytest
from agenticx.safety.audit import SafetyEvent, SafetyStage, SafetyAuditLog


def test_event_creation():
    event = SafetyEvent(
        tool_name="shell_tool",
        stage=SafetyStage.LEAK_DETECTION,
        action="REDACT",
        rule_ids=["openai_api_key"],
        severity="CRITICAL",
    )
    assert event.tool_name == "shell_tool"
    assert event.stage == SafetyStage.LEAK_DETECTION
    assert event.timestamp > 0


def test_audit_log_records_events():
    log = SafetyAuditLog(max_events=100)
    event = SafetyEvent(
        tool_name="test",
        stage=SafetyStage.POLICY_CHECK,
        action="BLOCK",
        rule_ids=["shell_injection"],
        severity="CRITICAL",
    )
    log.record(event)
    assert len(log.events) == 1
    assert log.events[0].tool_name == "test"


def test_audit_log_stats():
    log = SafetyAuditLog(max_events=100)
    for i in range(5):
        log.record(SafetyEvent(
            tool_name=f"tool_{i % 2}",
            stage=SafetyStage.INJECTION_DEFENSE,
            action="ESCAPED",
            rule_ids=["injection"],
            severity="HIGH",
        ))
    stats = log.stats()
    assert stats["total_events"] == 5
    assert "tool_0" in stats["by_tool"]
    assert SafetyStage.INJECTION_DEFENSE.value in stats["by_stage"]


def test_audit_log_max_events():
    log = SafetyAuditLog(max_events=3)
    for i in range(5):
        log.record(SafetyEvent(
            tool_name=f"tool_{i}",
            stage=SafetyStage.TRUNCATION,
            action="TRUNCATED",
            rule_ids=[],
            severity="LOW",
        ))
    assert len(log.events) == 3
    assert log.events[0].tool_name == "tool_2"


def test_audit_log_query_by_tool():
    log = SafetyAuditLog(max_events=100)
    log.record(SafetyEvent(
        tool_name="a", stage=SafetyStage.POLICY_CHECK,
        action="BLOCK", rule_ids=["r1"], severity="HIGH",
    ))
    log.record(SafetyEvent(
        tool_name="b", stage=SafetyStage.LEAK_DETECTION,
        action="REDACT", rule_ids=["r2"], severity="CRITICAL",
    ))
    log.record(SafetyEvent(
        tool_name="a", stage=SafetyStage.INJECTION_DEFENSE,
        action="ESCAPED", rule_ids=["r3"], severity="MEDIUM",
    ))
    results = log.query(tool_name="a")
    assert len(results) == 2


def test_audit_log_query_by_stage():
    log = SafetyAuditLog(max_events=100)
    log.record(SafetyEvent(
        tool_name="t1", stage=SafetyStage.LEAK_DETECTION,
        action="REDACT", rule_ids=["r1"], severity="HIGH",
    ))
    log.record(SafetyEvent(
        tool_name="t2", stage=SafetyStage.POLICY_CHECK,
        action="BLOCK", rule_ids=["r2"], severity="CRITICAL",
    ))
    log.record(SafetyEvent(
        tool_name="t3", stage=SafetyStage.LEAK_DETECTION,
        action="REDACT", rule_ids=["r3"], severity="HIGH",
    ))
    results = log.query(stage=SafetyStage.LEAK_DETECTION)
    assert len(results) == 2


def test_audit_log_query_by_severity():
    log = SafetyAuditLog(max_events=100)
    log.record(SafetyEvent(
        tool_name="t1", stage=SafetyStage.TRUNCATION,
        action="TRUNCATED", rule_ids=[], severity="LOW",
    ))
    log.record(SafetyEvent(
        tool_name="t2", stage=SafetyStage.POLICY_CHECK,
        action="BLOCK", rule_ids=["r1"], severity="CRITICAL",
    ))
    results = log.query(severity="CRITICAL")
    assert len(results) == 1
    assert results[0].tool_name == "t2"


def test_audit_log_empty_stats():
    log = SafetyAuditLog(max_events=100)
    stats = log.stats()
    assert stats["total_events"] == 0
    assert stats["by_tool"] == {}
    assert stats["by_stage"] == {}
    assert stats["by_severity"] == {}
