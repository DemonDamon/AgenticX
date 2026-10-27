#!/usr/bin/env python3
"""Secret redaction for events, streams, and log records.

Author: Damon Li
"""

from __future__ import annotations

import logging

import pytest

from agenticx.managed.redaction import (
    PROCESS_SECRETS,
    SecretRedactor,
    StreamRedactor,
    install_log_redaction,
)


def test_longest_first_and_min_len() -> None:
    redactor = SecretRedactor(
        {
            "short": "aaa-secret",
            "long": "aaa-secret-long",
            "tiny": "abcdefg",
        }
    )
    assert redactor.redact("x aaa-secret-long y") == "x [REDACTED:long] y"
    assert redactor.redact("aaa-secret") == "[REDACTED:short]"
    assert "abcdefg" not in redactor.values
    assert SecretRedactor({"tiny": "short"}).empty is True
    assert SecretRedactor({}).redact("plain") == "plain"


def test_redact_obj_deep() -> None:
    secret = "mcp-token-value-123" # gitleaks:allow
    redactor = SecretRedactor({"mcp": secret})
    payload = {
        "name": "echo",
        "input": {"text": f"see {secret}", "n": 1},
        "nested": [{"note": secret}],
    }
    cleaned = redactor.redact_obj(payload)
    assert cleaned["name"] == "echo"
    assert cleaned["input"]["n"] == 1
    assert secret not in str(cleaned)
    assert cleaned["input"]["text"] == "see [REDACTED:mcp]"
    assert cleaned["nested"][0]["note"] == "[REDACTED:mcp]"
    assert payload["input"]["text"].endswith(secret)


def test_stream_redactor_split_secret() -> None:
    secret = "sk-abcdefghij" # gitleaks:allow
    redactor = SecretRedactor({"k": secret})
    stream = StreamRedactor(redactor)
    first = stream.feed("x sk-abc")
    second = stream.feed("defghij y")
    tail = stream.flush()
    rendered = first + second + tail
    assert "[REDACTED:" in rendered
    for length in range(3, len(secret) + 1):
        for start in range(0, len(secret) - length + 1):
            assert secret[start : start + length] not in rendered


def test_log_factory_redacts_message_and_exception(caplog: pytest.LogCaptureFixture) -> None:
    secret = "log-secret-value-123456" # gitleaks:allow
    install_log_redaction()
    PROCESS_SECRETS.register("t", SecretRedactor({"k": secret}))
    caplog.set_level(logging.ERROR)
    logger = logging.getLogger("managed.redaction.test")
    try:
        logger.error("v=%s", secret)
        try:
            raise RuntimeError(secret)
        except RuntimeError:
            logger.exception("boom")
        assert secret not in caplog.text
        assert "[REDACTED:k]" in caplog.text
    finally:
        PROCESS_SECRETS.unregister("t")
