"""Tests for Data Suite managed template kit."""

from __future__ import annotations

import pytest

from agenticx.managed.templates.data_suite import (
    FakeWebhookSink,
    WebhookNotifier,
    WriteGuardPolicy,
    assert_read_only_tools,
    run_scheduled,
)


def test_fake_webhook_collects_events():
    sink = FakeWebhookSink()
    n = WebhookNotifier(sink)
    n.emit("quality_alert", metric="null_rate", value=0.5)
    assert len(sink.events) == 1
    assert sink.events[0].kind == "quality_alert"
    assert sink.events[0].payload["metric"] == "null_rate"


def test_assert_read_only_rejects_bash_exec():
    manifest = {
        "schema": "agx.agent/v1",
        "tools": [
            {
                "type": "agx_builtin",
                "configs": [{"name": "bash_exec", "enabled": True}],
            }
        ],
    }
    with pytest.raises(ValueError, match="bash_exec"):
        assert_read_only_tools(manifest)


def test_assert_read_only_allows_data_suite_tool():
    manifest = {
        "schema": "agx.agent/v1",
        "tools": [
            {
                "type": "custom",
                "name": "data_suite_sql_query",
                "description": "read-only sql",
                "input_schema": {"type": "object", "properties": {}},
            }
        ],
    }
    assert_read_only_tools(manifest, WriteGuardPolicy())


def test_run_scheduled_tags_tick_id():
    out = run_scheduled(lambda: {"ok": True}, tick_id="t-1")
    assert out == {"ok": True, "tick_id": "t-1"}
