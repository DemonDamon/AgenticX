"""HTTP evidence must not be inferred from URL or request identifiers."""

from types import SimpleNamespace

import pytest

from agenticx.llms.http_status import exception_chain, http_status_code
from agenticx.llms.provider_fault import classify_provider_fault


@pytest.mark.parametrize("code", [401, 402, 403, 429, 500, 503])
def test_url_and_request_metadata_are_not_status(code):
    error = ConnectionError(
        f"connection reset to https://example.invalid:{code}0/status/{code}; trace=req_{code}7"
    )
    assert http_status_code(error) is None
    assert classify_provider_fault(error) == "transient"


@pytest.mark.parametrize("message,expected", [
    ("HTTP 402", 402), ("HTTP/1.1 503 Service Unavailable", 503),
    ("Error code: 402", 402), ('{"status": 402}', 402),
    ("status_code=429", 429), ("429 too many requests", 429),
    ("status 403 forbidden", 403), ("status 401", 401),
])
def test_explicit_status_messages(message, expected):
    assert http_status_code(RuntimeError(message)) == expected


def test_structured_status_precedes_outer_message():
    inner = RuntimeError("upstream unavailable")
    inner.response = SimpleNamespace(status_code=402)
    outer = RuntimeError("HTTP 429")
    outer.original_exception = inner
    assert http_status_code(outer) == 402
    assert classify_provider_fault(outer) == "billing"


@pytest.mark.parametrize("attribute", ["status_code", "response"])
def test_structured_status_is_recognized(attribute):
    error = RuntimeError("connection reset")
    setattr(error, attribute, "429" if attribute == "status_code" else SimpleNamespace(status_code=429))
    assert http_status_code(error) == 429
    assert classify_provider_fault(error) == "rate_limit"


def test_suppressed_context_does_not_override_current_cause():
    try:
        raise RuntimeError("401 unauthorized")
    except RuntimeError:
        try:
            raise RuntimeError("new request failed") from ConnectionError("connection reset")
        except RuntimeError as current:
            assert http_status_code(current) is None
            assert classify_provider_fault(current) == "transient"


def test_raise_from_none_ignores_old_auth_error():
    try:
        raise RuntimeError("401 unauthorized")
    except RuntimeError:
        try:
            raise RuntimeError("new request failed") from None
        except RuntimeError as current:
            assert http_status_code(current) is None
            assert classify_provider_fault(current) == "unknown"


def test_unsuppressed_context_and_cyclic_wrapper_are_bounded():
    inner = RuntimeError("status 401")
    outer = RuntimeError("failed")
    outer.__context__ = inner
    inner.original_exception = outer
    assert list(exception_chain(outer)) == [outer, inner]
    assert http_status_code(outer) == 401


@pytest.mark.parametrize("value", [True, False, 4020, 402.0, "4020", "oops"])
def test_invalid_status_attributes_are_not_coerced(value):
    error = RuntimeError("failed")
    error.status_code = value
    assert http_status_code(error) is None


@pytest.mark.parametrize("status,message,expected", [
    (401, "HTTP 429 rate limit", "auth"),
    (402, "401 unauthorized", "billing"),
    (429, "401 unauthorized", "rate_limit"),
    (429, "payment_required", "rate_limit"),
    (503, "401 unauthorized", "transient"),
    (403, "overdue balance", "billing"),
    (403, "forbidden", "auth"),
])
def test_real_status_precedes_misleading_message(status, message, expected):
    error = RuntimeError(message)
    error.status_code = status
    assert classify_provider_fault(error) == expected
