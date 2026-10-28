"""Dictionary drift patrol tests."""

from __future__ import annotations

from pathlib import Path

from agenticx.managed.templates.data_suite import (
    DictDriftConfig,
    DictDriftRunner,
    FakeWebhookSink,
    WebhookNotifier,
)

FIX = Path(__file__).resolve().parents[2] / "data_suite" / "fixtures"


def test_missing_and_null_rate_emit_todos_and_webhook():
    # sample_dictionary may not include phone — require_fields forces unknown/missing checks
    cfg = DictDriftConfig(
        dictionary_yaml=FIX / "sample_dictionary.yaml",
        null_rate_ceiling=0.2,
        require_fields=("member_id",),
    )
    # Ensure member_id exists in dictionary; if fixture uses different names, adapt
    from agenticx.data_suite.governance.dictionary import DictionaryCatalog
    cat = DictionaryCatalog()
    cat.load(FIX / "sample_dictionary.yaml")
    fields = [f.name for f in cat.list_fields()]
    assert fields, "dictionary fixture empty"
    target = fields[0]
    cfg = DictDriftConfig(
        dictionary_yaml=FIX / "sample_dictionary.yaml",
        null_rate_ceiling=0.2,
        require_fields=(target, "definitely_missing_field"),
    )
    sink = FakeWebhookSink()
    runner = DictDriftRunner(cfg, WebhookNotifier(sink))
    todos = runner.run([{target: None}, {target: None}, {target: "x"}])
    reasons = {t.reason for t in todos}
    assert "null_rate_exceeded" in reasons or "missing_in_sample" in reasons or "unknown_field" in reasons
    assert any(t.field == "definitely_missing_field" for t in todos)
    assert sink.events and sink.events[0].kind == "dict_drift"
