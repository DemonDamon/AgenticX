#!/usr/bin/env python3
"""Tests for dynamic rule hot-reload on Policy and LeakDetector.

Author: Damon Li
"""

import pytest
from agenticx.safety.policy import Policy, PolicyRule, PolicyAction, PolicySeverity
from agenticx.safety.leak_detector import LeakDetector, LeakPattern, LeakSeverity, LeakAction


def test_policy_add_rule_at_runtime():
    p = Policy()
    initial_count = len(p.rules)
    new_rule = PolicyRule("custom_block", "Block custom",
                          PolicySeverity.HIGH, r"EVIL_PATTERN", PolicyAction.BLOCK)
    p.add_rule(new_rule)
    assert len(p.rules) == initial_count + 1
    result = p.check("contains EVIL_PATTERN here")
    assert result.is_blocked is True


def test_policy_remove_rule_at_runtime():
    p = Policy()
    p.remove_rule("sql_pattern")
    result = p.check("DROP TABLE users")
    assert len(result.matched_rules) == 0


def test_policy_rules_property_returns_copy():
    p = Policy()
    rules = p.rules
    rules.append(PolicyRule("fake", "fake", PolicySeverity.LOW, r"x", PolicyAction.WARN))
    assert len(p.rules) < len(rules)


def test_leak_detector_add_pattern_at_runtime():
    d = LeakDetector()
    initial_count = len(d.patterns)
    new_pat = LeakPattern("custom_key", r"CUSTOM-[A-Z]{10}",
                          LeakSeverity.HIGH, LeakAction.BLOCK)
    d.add_pattern(new_pat)
    assert len(d.patterns) == initial_count + 1
    result = d.scan("key is CUSTOM-ABCDEFGHIJ here")
    assert result.has_matches is True


def test_leak_detector_remove_pattern_at_runtime():
    d = LeakDetector()
    d.remove_pattern("generic_api_key_param")
    result = d.scan("api_key=test123")
    matching_names = [m.pattern_name for m in result.matches]
    assert "generic_api_key_param" not in matching_names


def test_leak_detector_patterns_property_returns_copy():
    d = LeakDetector()
    patterns = d.patterns
    original_len = len(d.patterns)
    patterns.append(LeakPattern("fake", r"x", LeakSeverity.LOW, LeakAction.WARN))
    assert len(d.patterns) == original_len
