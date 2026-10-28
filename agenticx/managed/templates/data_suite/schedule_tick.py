"""Schedule tick helpers for data-suite patrol (cron string is metadata only)."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional, TypeVar, Union

import yaml

from agenticx.managed.templates.data_suite.dict_drift import DictDriftConfig, DictDriftRunner
from agenticx.managed.templates.data_suite.quality_patrol import QualityPatrolConfig, QualityPatrolRunner
from agenticx.managed.templates.data_suite.webhook import (
    FakeWebhookSink,
    HttpWebhookSink,
    Sink,
    WebhookNotifier,
)

T = TypeVar("T")


def run_scheduled(fn: Callable[[], T], *, tick_id: str) -> T:
    """Run ``fn`` once and tag result metadata when it is a dict."""
    result = fn()
    if isinstance(result, dict) and "tick_id" not in result:
        out = dict(result)
        out["tick_id"] = tick_id
        return out  # type: ignore[return-value]
    return result


@dataclass(frozen=True)
class PatrolScheduleConfig:
    tick_id: str
    cron: str  # stored metadata; no live cron daemon required
    webhook_url: Optional[str]
    quality_patrol_yaml: Path
    dict_drift_yaml: Path
    fixtures_dir: Path

    @classmethod
    def load(cls, path: Union[str, Path]) -> "PatrolScheduleConfig":
        cfg_path = Path(path)
        raw = yaml.safe_load(cfg_path.read_text(encoding="utf-8")) or {}
        base = cfg_path.parent

        def _resolve(key: str, default: str = "") -> Path:
            ref = str(raw.get(key) or default)
            p = Path(ref)
            if not p.is_absolute():
                p = (base / p).resolve()
            return p

        fixtures = _resolve("fixtures_dir", ".")
        q = _resolve("quality_patrol_yaml")
        d = _resolve("dict_drift_yaml")
        url = raw.get("webhook_url")
        webhook_url = str(url).strip() if url not in (None, "", False) else None
        return cls(
            tick_id=str(raw.get("tick_id") or "patrol"),
            cron=str(raw.get("cron") or ""),
            webhook_url=webhook_url,
            quality_patrol_yaml=q,
            dict_drift_yaml=d,
            fixtures_dir=fixtures,
        )


def run_patrol_tick(
    rows: List[Dict[str, Any]],
    *,
    cfg: PatrolScheduleConfig,
    quarantine: Optional[List[Dict[str, Any]]] = None,
    sink: Optional[Sink] = None,
) -> Dict[str, Any]:
    """Run quality + dict-drift once under ``cfg.tick_id``; Fake sink when no webhook_url."""
    if sink is None:
        if cfg.webhook_url:
            sink = HttpWebhookSink(cfg.webhook_url)
        else:
            sink = FakeWebhookSink()

    notifier = WebhookNotifier(sink)
    mode = "http" if isinstance(sink, HttpWebhookSink) else "fake"

    def tick() -> Dict[str, Any]:
        qcfg = QualityPatrolConfig.load(cfg.quality_patrol_yaml, fixtures_dir=cfg.fixtures_dir)
        QualityPatrolRunner(qcfg, notifier).run(rows, quarantine=quarantine)
        dcfg = DictDriftConfig.load(cfg.dict_drift_yaml, fixtures_dir=cfg.fixtures_dir)
        todos = DictDriftRunner(dcfg, notifier).run(rows)
        return {"todos": len(todos)}

    out = run_scheduled(tick, tick_id=cfg.tick_id)
    events = getattr(sink, "events", []) or []
    kinds = [getattr(e, "kind", None) for e in events]
    return {
        "tick_id": out.get("tick_id") if isinstance(out, dict) else cfg.tick_id,
        "cron": cfg.cron,
        "webhook_url": cfg.webhook_url,
        "webhook_mode": mode,
        "webhook_kinds": list(kinds),
        "webhook_count": len(events),
        "todos": out.get("todos") if isinstance(out, dict) else 0,
        "events": events,
        "sink": sink,
    }
