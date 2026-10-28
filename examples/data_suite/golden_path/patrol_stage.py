"""Stage 5: A8 quality + dict-drift patrol with FakeWebhookSink."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from agenticx.managed.templates.data_suite import (
    DictDriftConfig,
    DictDriftRunner,
    FakeWebhookSink,
    QualityPatrolConfig,
    QualityPatrolRunner,
    WebhookNotifier,
    run_scheduled,
)

ROOT = Path(__file__).resolve().parent
SEED = ROOT / "seed"


def run_patrol_stage(
    rows: List[Dict[str, Any]],
    *,
    quality_patrol_yaml: Union[str, Path, None] = None,
    dict_drift_yaml: Union[str, Path, None] = None,
    dirty_rows: Optional[List[Dict[str, Any]]] = None,
    quarantine: Optional[List[Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    """Run schedule tick; use dirty_rows (default: inject nulls) so demo webhooks fire."""
    q_path = Path(quality_patrol_yaml) if quality_patrol_yaml is not None else SEED / "quality_patrol.yaml"
    d_path = Path(dict_drift_yaml) if dict_drift_yaml is not None else SEED / "dict_drift.yaml"

    sink = FakeWebhookSink()
    notifier = WebhookNotifier(sink)

    if dirty_rows is None:
        dirty = [dict(r) for r in rows[:5]]
        for r in dirty[:2]:
            r["member_id"] = None
        dirty_rows = dirty
    if quarantine is None:
        quarantine = [{"rule_id": "demo_null", "row": {}, "reason": "injected"}]

    def tick():
        qcfg = QualityPatrolConfig.load(q_path, fixtures_dir=SEED)
        QualityPatrolRunner(qcfg, notifier).run(dirty_rows, quarantine=quarantine)
        dcfg = DictDriftConfig.load(d_path, fixtures_dir=SEED)
        todos = DictDriftRunner(dcfg, notifier).run(dirty_rows)
        return {"todos": len(todos)}

    out = run_scheduled(tick, tick_id="golden-path")
    kinds = [getattr(e, "kind", None) or (e.get("kind") if isinstance(e, dict) else None) for e in sink.events]
    # FakeWebhookSink may store WebhookEvent objects
    if kinds and kinds[0] is None:
        kinds = [e.kind for e in sink.events]
    return {
        "tick_id": out.get("tick_id") if isinstance(out, dict) else "golden-path",
        "webhook_kinds": list(kinds),
        "webhook_count": len(sink.events),
        "todos": out.get("todos") if isinstance(out, dict) else 0,
        "events": sink.events,
    }
