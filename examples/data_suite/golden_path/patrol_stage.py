"""Stage 5: A8 quality + dict-drift patrol via run_patrol_tick (Fake by default)."""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from agenticx.managed.templates.data_suite import PatrolScheduleConfig, run_patrol_tick

ROOT = Path(__file__).resolve().parent
SEED = ROOT / "seed"


def run_patrol_stage(
    rows: List[Dict[str, Any]],
    *,
    quality_patrol_yaml: Union[str, Path, None] = None,
    dict_drift_yaml: Union[str, Path, None] = None,
    dirty_rows: Optional[List[Dict[str, Any]]] = None,
    quarantine: Optional[List[Dict[str, Any]]] = None,
    webhook_url: Optional[str] = None,
    tick_id: str = "golden-path",
    cron: str = "0 6 * * *",
) -> Dict[str, Any]:
    """Run schedule tick; use dirty_rows (default: inject nulls) so demo webhooks fire.

    When ``webhook_url`` is omitted, ``run_patrol_tick`` uses FakeWebhookSink.
    """
    q_path = Path(quality_patrol_yaml) if quality_patrol_yaml is not None else SEED / "quality_patrol.yaml"
    d_path = Path(dict_drift_yaml) if dict_drift_yaml is not None else SEED / "dict_drift.yaml"

    if dirty_rows is None:
        dirty = [dict(r) for r in rows[:5]]
        for r in dirty[:2]:
            r["member_id"] = None
        dirty_rows = dirty
    if quarantine is None:
        quarantine = [{"rule_id": "demo_null", "row": {}, "reason": "injected"}]

    cfg = PatrolScheduleConfig(
        tick_id=tick_id,
        cron=cron,
        webhook_url=webhook_url,
        quality_patrol_yaml=q_path,
        dict_drift_yaml=d_path,
        fixtures_dir=SEED,
    )
    out = run_patrol_tick(dirty_rows, cfg=cfg, quarantine=quarantine)
    return {
        "tick_id": out["tick_id"],
        "webhook_kinds": list(out["webhook_kinds"]),
        "webhook_count": out["webhook_count"],
        "todos": out.get("todos", 0),
        "events": out.get("events", []),
        "webhook_mode": out.get("webhook_mode"),
    }
