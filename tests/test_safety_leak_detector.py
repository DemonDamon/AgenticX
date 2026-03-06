#!/usr/bin/env python3
"""Tests for safety leak detector.

Author: Damon Li
"""

import pytest
from agenticx.safety.leak_detector import (
    LeakDetector,
    LeakAction,
    LeakSeverity,
    LeakPattern,
    LeakScanResult,
    SecretLeakError,
)


class TestLeakDetectorBasic:
    """Test basic leak detection patterns."""

    def test_detect_openai_api_key(self):
        detector = LeakDetector()
        result = detector.scan("Here is the key: sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234")
        assert result.has_matches
        assert any(m.pattern_name == "openai_api_key" for m in result.matches)

    def test_detect_aws_access_key(self):
        detector = LeakDetector()
        result = detector.scan("AWS key: AKIAIOSFODNN7EXAMPLE")
        assert result.has_matches
        assert any(m.pattern_name == "aws_access_key" for m in result.matches)

    def test_detect_github_token(self):
        detector = LeakDetector()
        result = detector.scan("token: ghp_1234567890abcdefABCDEF1234567890abcd")
        assert result.has_matches
        assert any(m.pattern_name == "github_token" for m in result.matches)

    def test_no_false_positive_on_clean_text(self):
        detector = LeakDetector()
        result = detector.scan("This is a normal message without any secrets.")
        assert not result.has_matches
        assert len(result.matches) == 0

    def test_redact_replaces_secret(self):
        detector = LeakDetector()
        result = detector.scan("key: sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234")
        assert result.redacted_content is not None
        assert "sk-proj-" not in result.redacted_content
        assert "[REDACTED:" in result.redacted_content

    def test_block_action_raises_error(self):
        detector = LeakDetector()
        with pytest.raises(SecretLeakError):
            detector.scan_and_block("key: sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234")


class TestLeakDetectorPatterns:
    """Test all built-in patterns."""

    def test_detect_anthropic_key(self):
        detector = LeakDetector()
        result = detector.scan("sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345678901234567890123456789-ABCDE")
        assert result.has_matches

    def test_detect_private_key_pem(self):
        detector = LeakDetector()
        result = detector.scan("-----BEGIN RSA PRIVATE KEY-----\nMIIEow...")
        assert result.has_matches
        assert any(m.severity == LeakSeverity.CRITICAL for m in result.matches)

    def test_detect_bearer_token(self):
        detector = LeakDetector()
        result = detector.scan("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc")
        assert result.has_matches

    def test_scan_and_clean_returns_safe_content(self):
        detector = LeakDetector()
        clean = detector.scan_and_clean("key=sk-proj-abc123def456ghi789jkl012mno345pqr678stu901vwx234 ok")
        assert "sk-proj-" not in clean
        assert "ok" in clean


class TestLeakDetectorCustomPatterns:
    """Test custom pattern support."""

    def test_custom_pattern(self):
        custom = LeakPattern(
            name="my_secret",
            pattern=r"MY_SECRET_[A-Z0-9]{16}",
            severity=LeakSeverity.HIGH,
            action=LeakAction.REDACT,
        )
        detector = LeakDetector(extra_patterns=[custom])
        result = detector.scan("token: MY_SECRET_ABCDEF0123456789")
        assert result.has_matches
        assert any(m.pattern_name == "my_secret" for m in result.matches)
