#!/usr/bin/env python3
"""Tests for safety policy engine.

Author: Damon Li
"""

import pytest
from agenticx.safety.policy import (
    Policy,
    PolicyRule,
    PolicyAction,
    PolicySeverity,
    PolicyCheckResult,
)


class TestPolicyEngine:
    def test_default_rules_block_system_file_access(self):
        policy = Policy()
        result = policy.check("reading /etc/passwd for config")
        assert result.is_blocked

    def test_default_rules_block_private_key(self):
        policy = Policy()
        result = policy.check("-----BEGIN RSA PRIVATE KEY-----")
        assert result.is_blocked

    def test_default_rules_block_shell_injection(self):
        policy = Policy()
        result = policy.check("run this; rm -rf /")
        assert result.is_blocked

    def test_clean_content_passes(self):
        policy = Policy()
        result = policy.check("Calculate the sum of 2 + 3")
        assert not result.is_blocked
        assert len(result.matched_rules) == 0

    def test_warn_on_sql_pattern(self):
        policy = Policy()
        result = policy.check("SELECT * FROM users WHERE id = 1; DROP TABLE users;")
        assert not result.is_blocked
        assert any(r.action == PolicyAction.WARN for r in result.matched_rules)

    def test_custom_rule(self):
        custom = PolicyRule(
            id="no_profanity",
            description="Block profanity",
            severity=PolicySeverity.MEDIUM,
            pattern=r"(?i)\bbad_word\b",
            action=PolicyAction.BLOCK,
        )
        policy = Policy(extra_rules=[custom])
        result = policy.check("This has a bad_word in it")
        assert result.is_blocked
