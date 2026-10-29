"""JSON file persistence for Rule entities.

Path resolution: explicit ``root`` argument, else ``AGX_RULES_STORE_DIR``,
else a process-local default under the cwd (``.runtime/rules``).
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Dict, List, Optional, Union

from agenticx.rules.model import (
    Rule,
    RuleStatus,
    RuleTransitionError,
    apply_transition,
    utc_now_iso,
)

_DEFAULT_REL = Path(".runtime") / "rules"


def resolve_store_dir(root: Optional[Union[str, Path]] = None) -> Path:
    if root is not None:
        return Path(root)
    env = os.environ.get("AGX_RULES_STORE_DIR", "").strip()
    if env:
        return Path(env)
    return Path.cwd() / _DEFAULT_REL


class RuleFileStore:
    """Upsert / list / transition Rule rows in ``rules.json``."""

    def __init__(self, root: Optional[Union[str, Path]] = None) -> None:
        self.root = resolve_store_dir(root)
        self._path = self.root / "rules.json"
        self._rules: Dict[str, Rule] = {}
        self._load()

    def _load(self) -> None:
        self._rules.clear()
        if not self._path.is_file():
            return
        raw = json.loads(self._path.read_text(encoding="utf-8")) or {}
        for row in raw.get("rules") or []:
            rule = Rule.from_dict(row)
            self._rules[rule.id] = rule

    def _persist(self) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        payload = {"rules": [self._rules[k].to_dict() for k in sorted(self._rules)]}
        self._path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )

    def list_rules(self) -> List[Rule]:
        return [self._rules[k] for k in sorted(self._rules)]

    def get_rule(self, rule_id: str) -> Rule:
        try:
            return self._rules[rule_id]
        except KeyError as e:
            raise KeyError(rule_id) from e

    def upsert_rule(self, rule: Rule, *, bump_version: bool = False) -> Rule:
        if not isinstance(rule, Rule):
            raise TypeError("rule must be a Rule")
        now = utc_now_iso()
        existing = self._rules.get(rule.id)
        if existing is None:
            stored = Rule.from_dict({**rule.to_dict(), "created_at": rule.created_at or now, "updated_at": now})
        else:
            version = existing.version + 1 if bump_version else max(existing.version, rule.version)
            payload = rule.to_dict()
            payload["version"] = version
            payload["created_at"] = existing.created_at
            payload["updated_at"] = now
            stored = Rule.from_dict(payload)
        self._rules[stored.id] = stored
        self._persist()
        return stored

    def transition(self, rule_id: str, to: RuleStatus) -> Rule:
        current = self.get_rule(rule_id)
        updated = apply_transition(current, to)
        self._rules[rule_id] = updated
        self._persist()
        return updated

    def set_enabled(self, rule_id: str, enabled: bool) -> Rule:
        rule = self.get_rule(rule_id)
        if enabled and rule.status is not RuleStatus.ACTIVE:
            raise RuleTransitionError(
                f"cannot enable rule {rule_id!r} while status is {rule.status.value}"
            )
        if (not enabled) and rule.status is RuleStatus.ACTIVE:
            return self.transition(rule_id, RuleStatus.DISABLED)
        now = utc_now_iso()
        from dataclasses import replace

        updated = replace(rule, enabled=bool(enabled), updated_at=now)
        self._rules[rule_id] = updated
        self._persist()
        return updated
