"""Smoke tests for request-scoped OTel correlation keys.

Author: Damon Li
"""

from types import SimpleNamespace


def test_apply_skips_empty_and_sets_bound_keys():
    from agenticx.observability.correlation import (
        apply_correlation_attributes,
        bind_correlation,
        reset_correlation,
    )

    class _Span:
        def __init__(self):
            self.attrs = {}

        def set_attribute(self, key, value):
            self.attrs[key] = value

    reset_correlation()
    span = _Span()
    apply_correlation_attributes(span)
    assert span.attrs == {}

    tok = bind_correlation(
        session_id="sess-1",
        tenant_id="t-1",
        deployment_id="dep-1",
        gateway_trace_id="01ARZ3NDEKTSV4RRFFQ69G5FAV",
    )
    try:
        span2 = _Span()
        apply_correlation_attributes(span2)
        assert span2.attrs["agenticx.session.id"] == "sess-1"
        assert span2.attrs["agenticx.tenant.id"] == "t-1"
        assert span2.attrs["agenticx.deployment.id"] == "dep-1"
        assert span2.attrs["agenticx.gateway.trace_id"] == "01ARZ3NDEKTSV4RRFFQ69G5FAV"
    finally:
        reset_correlation(tok)


def test_bind_correlation_from_session_reads_session_id():
    from agenticx.observability.correlation import (
        bind_correlation_from_session,
        current_correlation,
        reset_correlation,
    )

    tokens = bind_correlation_from_session(SimpleNamespace(session_id="abc"))
    try:
        corr = current_correlation()
        assert corr["session_id"] == "abc"
        assert "tenant_id" not in corr
    finally:
        reset_correlation(tokens)


def test_bind_correlation_from_session_prefers_session_id_attr():
    from agenticx.observability.correlation import (
        bind_correlation_from_session,
        current_correlation,
        reset_correlation,
    )

    session = SimpleNamespace(session_id="from-attr", _session_id="from-underscore")
    tokens = bind_correlation_from_session(session)
    try:
        assert current_correlation()["session_id"] == "from-attr"
    finally:
        reset_correlation(tokens)
