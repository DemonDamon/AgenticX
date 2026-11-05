"""Retry decisions share the same HTTP evidence as provider fault reporting."""

from types import SimpleNamespace

import pytest

from agenticx.runtime.llm_retry import LLMRetryPolicy, _classify_error


@pytest.mark.parametrize("message", [
    "connection reset http://127.0.0.1:4020/v1",
    "request failed https://example.invalid/429/test",
    "request failed request_id=req_5007",
])
def test_request_metadata_does_not_trigger_status_retry(message):
    assert _classify_error(ConnectionError(message)) == "unknown"


@pytest.mark.parametrize("status,expected", [(401,"unknown"), (402,"unknown"), (429,"rate_limit"), (500,"server_error"), (503,"server_error"), (599,"server_error")])
def test_structured_status_drives_retry(status, expected):
    error = RuntimeError("request failed")
    error.response = SimpleNamespace(status_code=status)
    assert _classify_error(error) == expected


def test_explicit_nonretryable_status_beats_retry_words():
    error = RuntimeError("rate limit and service unavailable")
    error.status_code = 401
    assert _classify_error(error) == "unknown"


@pytest.mark.parametrize("message,expected", [("HTTP 429", "rate_limit"), ("Error code: 503", "server_error"), ("resource_exhausted", "rate_limit"), ("service unavailable", "server_error")])
def test_explicit_status_and_existing_semantics_are_preserved(message, expected):
    assert _classify_error(RuntimeError(message)) == expected


def test_live_cause_is_used_but_suppressed_context_is_not():
    inner = RuntimeError("upstream failed")
    inner.status_code = 503
    outer = RuntimeError("wrapped")
    outer.__cause__ = inner
    assert _classify_error(outer) == "server_error"
    outer.__cause__ = None
    outer.__context__ = inner
    outer.__suppress_context__ = True
    assert _classify_error(outer) == "unknown"


def test_status_retry_budget_and_polluted_error_call_counts(monkeypatch):
    monkeypatch.setenv("AGX_LLM_RETRY_RATE_LIMIT", "2")
    monkeypatch.setattr("agenticx.runtime.llm_retry.time.sleep", lambda _: None)
    policy = LLMRetryPolicy(base_delay=0)
    attempts = 0

    def limited():
        nonlocal attempts
        attempts += 1
        if attempts < 3:
            raise RuntimeError("HTTP 429")
        return "ok"

    assert policy.call_sync_with_retry(limited) == "ok"
    assert attempts == 3
    attempts = 0

    def polluted():
        nonlocal attempts
        attempts += 1
        raise RuntimeError("request_id=req_5007")

    with pytest.raises(RuntimeError, match="req_5007"):
        policy.call_sync_with_retry(polluted)
    assert attempts == 1
