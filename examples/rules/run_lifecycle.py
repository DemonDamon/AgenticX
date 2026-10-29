#!/usr/bin/env python3
"""Run draft → pending → active → compile → execution record (synthetic sample)."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from agenticx.rules.compile import compile_rule
from agenticx.rules.dsl import parse_rule_body
from agenticx.rules.execution import ExecutionFileStore
from agenticx.rules.model import Rule, RuleMeta, RuleStatus
from agenticx.rules.store import RuleFileStore

SAMPLE = Path(__file__).resolve().parent / "sample_threshold_rule.yaml"


def load_sample_rule() -> Rule:
    raw = yaml.safe_load(SAMPLE.read_text(encoding="utf-8"))
    body = parse_rule_body(raw.get("body") or {})
    meta_raw = raw.get("meta") or {}
    return Rule(
        id=str(raw.get("id") or "brand-a-temp-threshold"),
        name=str(raw.get("name") or "sample threshold"),
        body=body.to_dict(),
        meta=RuleMeta(
            scope=str(meta_raw.get("scope") or ""),
            priority=int(meta_raw.get("priority") or 100),
            trigger=str(meta_raw.get("trigger") or "event"),
            tags=list(meta_raw.get("tags") or []),
        ),
    )


def run_lifecycle(store_root: Path) -> dict:
    rules = RuleFileStore(store_root)
    execs = ExecutionFileStore(store_root)
    rule = load_sample_rule()
    rules.upsert_rule(rule)
    rules.transition(rule.id, RuleStatus.PENDING)
    active = rules.transition(rule.id, RuleStatus.ACTIVE)
    plan = compile_rule(active)
    record = execs.record_run(
        rule_id=active.id,
        rule_version=active.version,
        nodes=plan.nodes,
        status="completed",
    )
    return {
        "rule_id": active.id,
        "status": active.status.value,
        "enabled": active.enabled,
        "backend": plan.backend,
        "node_types": [n.get("type") for n in plan.nodes],
        "execution_id": record.id,
        "execution_status": record.status,
        "store": str(store_root),
    }


def main(argv: list[str] | None = None) -> int:
    args = list(sys.argv[1:] if argv is None else argv)
    store_root = Path(args[0]) if args else Path.cwd() / ".runtime" / "rules-lifecycle-demo"
    report = run_lifecycle(store_root)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
