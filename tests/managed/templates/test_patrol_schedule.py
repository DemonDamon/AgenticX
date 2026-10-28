"""S2-7: patrol schedule config + HttpWebhookSink."""

from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Dict, List
from urllib.error import URLError

import pytest
import yaml

from agenticx.managed.templates.data_suite import (
    FakeWebhookSink,
    HttpWebhookSink,
    PatrolScheduleConfig,
    WebhookEvent,
    run_patrol_tick,
)

ROOT = Path(__file__).resolve().parents[3]
EX = ROOT / "examples" / "managed" / "data_suite"
FIX = ROOT / "tests" / "data_suite" / "fixtures"


class _CaptureHandler(BaseHTTPRequestHandler):
    events: List[Dict[str, Any]] = []

    def do_POST(self) -> None:  # noqa: N802
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length)
        _CaptureHandler.events.append(
            {
                "path": self.path,
                "content_type": self.headers.get("Content-Type"),
                "body": json.loads(body.decode("utf-8")),
            }
        )
        self.send_response(200)
        self.end_headers()
        self.wfile.write(b"ok")

    def log_message(self, format: str, *args) -> None:  # noqa: A003
        return


@pytest.fixture
def http_sink_server():
    _CaptureHandler.events = []
    server = HTTPServer(("127.0.0.1", 0), _CaptureHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address[:2]
    url = f"http://{host}:{port}/hooks/patrol"
    try:
        yield url, _CaptureHandler
    finally:
        server.shutdown()
        thread.join(timeout=2)


def test_http_webhook_sink_posts_json(http_sink_server):
    url, handler = http_sink_server
    sink = HttpWebhookSink(url, timeout=2.0)
    sink.post(WebhookEvent(kind="quality_alert", payload={"metric": "null_rate", "value": 0.5}))
    assert len(handler.events) == 1
    evt = handler.events[0]
    assert evt["content_type"] and "application/json" in evt["content_type"]
    assert evt["body"]["kind"] == "quality_alert"
    assert evt["body"]["payload"]["metric"] == "null_rate"
    assert sink.events[-1].kind == "quality_alert"


def test_http_webhook_sink_raises_on_unreachable():
    sink = HttpWebhookSink("http://127.0.0.1:1/nope", timeout=0.2)
    with pytest.raises((URLError, OSError, TimeoutError)):
        sink.post(WebhookEvent(kind="dict_drift", payload={"count": 1}))


def test_patrol_schedule_config_load():
    path = EX / "patrol-schedule.yaml"
    assert path.is_file()
    cfg = PatrolScheduleConfig.load(path)
    assert cfg.tick_id == "data-suite-patrol"
    assert cfg.cron  # metadata only
    assert cfg.quality_patrol_yaml.is_file()
    assert cfg.dict_drift_yaml.is_file()
    assert cfg.fixtures_dir.is_dir()


def test_run_patrol_tick_fake_default():
    cfg = PatrolScheduleConfig(
        tick_id="unit-fake",
        cron="0 6 * * *",
        webhook_url=None,
        quality_patrol_yaml=FIX / "sample_quality_patrol.yaml",
        dict_drift_yaml=FIX / "sample_dict_drift.yaml",
        fixtures_dir=FIX,
    )
    rows = [
        {"member_id": None, "phone": None},
        {"member_id": None, "phone": "1"},
        {"member_id": "1", "phone": "2"},
    ]
    out = run_patrol_tick(rows, cfg=cfg, quarantine=[{"rule_id": "x"}])
    assert out["tick_id"] == "unit-fake"
    assert out["webhook_mode"] == "fake"
    assert out["webhook_count"] >= 1
    kinds = set(out["webhook_kinds"])
    assert "quality_alert" in kinds or "dict_drift" in kinds
    assert isinstance(out["sink"], FakeWebhookSink)


def test_run_patrol_tick_http(http_sink_server):
    url, handler = http_sink_server
    cfg = PatrolScheduleConfig(
        tick_id="unit-http",
        cron="0 6 * * *",
        webhook_url=url,
        quality_patrol_yaml=FIX / "sample_quality_patrol.yaml",
        dict_drift_yaml=FIX / "sample_dict_drift.yaml",
        fixtures_dir=FIX,
    )
    rows = [
        {"member_id": None, "phone": None},
        {"member_id": None, "phone": "1"},
        {"member_id": "1", "phone": "2"},
    ]
    out = run_patrol_tick(rows, cfg=cfg, quarantine=[{"rule_id": "x"}])
    assert out["tick_id"] == "unit-http"
    assert out["webhook_mode"] == "http"
    assert out["webhook_count"] >= 1
    assert len(handler.events) == out["webhook_count"]
    posted_kinds = {e["body"]["kind"] for e in handler.events}
    assert "quality_alert" in posted_kinds or "dict_drift" in posted_kinds


def test_example_yaml_roundtrip_keys():
    raw = yaml.safe_load((EX / "patrol-schedule.yaml").read_text(encoding="utf-8"))
    assert "tick_id" in raw
    assert "cron" in raw
    assert "quality_patrol_yaml" in raw
    assert "dict_drift_yaml" in raw
