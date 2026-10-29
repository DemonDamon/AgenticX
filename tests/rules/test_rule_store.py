"""RuleFileStore persistence."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from agenticx.rules.model import Rule, RuleMeta, RuleStatus, RuleTransitionError
from agenticx.rules.store import RuleFileStore


def test_empty_store_lists(tmp_path: Path) -> None:
    store = RuleFileStore(tmp_path)
    assert store.list_rules() == []


def test_upsert_list_get_persist_reload(tmp_path: Path) -> None:
    store = RuleFileStore(tmp_path)
    store.upsert_rule(
        Rule(
            id="rule-a",
            name="Alpha",
            meta=RuleMeta(scope="ws", priority=50, trigger="schedule"),
            body={"object": "device"},
        )
    )
    store.upsert_rule(Rule(id="rule-b", name="Beta"))
    assert [r.id for r in store.list_rules()] == ["rule-a", "rule-b"]

    got = store.get_rule("rule-a")
    assert got.name == "Alpha"
    assert got.meta.priority == 50
    assert got.version == 1

    store.upsert_rule(
        Rule(id="rule-a", name="Alpha v2", body={"object": "device", "x": 1}),
        bump_version=True,
    )
    assert store.get_rule("rule-a").version == 2
    assert store.get_rule("rule-a").name == "Alpha v2"

    disk = json.loads((tmp_path / "rules.json").read_text(encoding="utf-8"))
    assert len(disk["rules"]) == 2

    reloaded = RuleFileStore(tmp_path)
    assert reloaded.get_rule("rule-a").version == 2
    assert reloaded.get_rule("rule-a").body["x"] == 1


def test_get_missing_raises(tmp_path: Path) -> None:
    store = RuleFileStore(tmp_path)
    with pytest.raises(KeyError):
        store.get_rule("missing")


def test_transition_and_enable(tmp_path: Path) -> None:
    store = RuleFileStore(tmp_path)
    store.upsert_rule(Rule(id="r1", name="n"))
    store.transition("r1", RuleStatus.PENDING)
    active = store.transition("r1", RuleStatus.ACTIVE)
    assert active.enabled is True
    disabled = store.set_enabled("r1", False)
    assert disabled.status is RuleStatus.DISABLED
    assert disabled.enabled is False

    store.upsert_rule(Rule(id="r2", name="draft"))
    with pytest.raises(RuleTransitionError):
        store.set_enabled("r2", True)


def test_store_dir_from_env(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AGX_RULES_STORE_DIR", str(tmp_path))
    store = RuleFileStore()
    store.upsert_rule(Rule(id="env-1", name="From env"))
    assert (tmp_path / "rules.json").is_file()
