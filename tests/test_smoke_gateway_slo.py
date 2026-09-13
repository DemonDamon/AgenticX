"""Smoke tests for read-only channel SLO query.

Author: Damon Li
"""

from __future__ import annotations

import json
from pathlib import Path

PROM_FIXTURE = """# TYPE agx_gateway_ttft_seconds histogram
agx_gateway_ttft_seconds_sum{model="m1",channel="ch-a",inbound_protocol="openai-chat"} 1.2
agx_gateway_ttft_seconds_count{model="m1",channel="ch-a",inbound_protocol="openai-chat"} 2
agx_gateway_ttft_seconds_sum{model="m1",channel="ch-a",inbound_protocol="openai-legacy"} 0.3
agx_gateway_ttft_seconds_count{model="m1",channel="ch-a",inbound_protocol="openai-legacy"} 1
# TYPE agx_gateway_tokens_per_second histogram
agx_gateway_tokens_per_second_sum{model="m1",channel="ch-a"} 90
agx_gateway_tokens_per_second_count{model="m1",channel="ch-a"} 3
# TYPE agx_plugin_errors_total counter
agx_plugin_errors_total{plugin="moderation"} 2
agx_gateway_channel_health{channel="ch-a",status="healthy"} 1
"""

STATS_FIXTURE = {
    "code": "00000",
    "message": "ok",
    "data": {
        "enabled": True,
        "stats": {
            "ch-a": {
                "success_count": 10,
                "failure_count": 2,
                "success_rate": 0.83,
                "p50_latency_ms": 120,
                "last_error": "upstream timeout",
                "cooldown_until": "2099-01-01T00:00:00Z",
            },
            "ch-b": {
                "success_count": 4,
                "failure_count": 0,
                "last_error": "",
                "cooldown_until": None,
            },
        },
    },
}


def _write_slo_files(tmp_path: Path) -> tuple[Path, Path]:
    metrics = tmp_path / "metrics.prom"
    stats = tmp_path / "stats.json"
    metrics.write_text(PROM_FIXTURE, encoding="utf-8")
    stats.write_text(json.dumps(STATS_FIXTURE), encoding="utf-8")
    return metrics, stats


def _use_slo_files(tmp_path: Path, monkeypatch) -> tuple[Path, Path]:
    metrics, stats = _write_slo_files(tmp_path)
    monkeypatch.setenv("AGENTICX_GATEWAY_METRICS_FILE", str(metrics))
    monkeypatch.setenv("AGENTICX_GATEWAY_CHANNEL_STATS_FILE", str(stats))
    monkeypatch.delenv("AGENTICX_GATEWAY_METRICS_URL", raising=False)
    monkeypatch.delenv("AGENTICX_GATEWAY_CHANNEL_STATS_URL", raising=False)
    return metrics, stats


def test_parse_prom_merges_ttft_protocols():
    from agenticx.ops.slo import parse_prom_text

    parsed = parse_prom_text(PROM_FIXTURE)
    ttft = parsed.ttft[("ch-a", "m1")]
    assert ttft.count == 3
    assert ttft.sum == 1.5
    assert not any("health" in name for name in ("ttft", "tps"))
    assert ("ch-a", "healthy") not in parsed.ttft
    assert "healthy" not in parsed.plugin_errors


def test_parse_prom_tps_and_plugin():
    from agenticx.ops.slo import parse_prom_text

    parsed = parse_prom_text(PROM_FIXTURE)
    tps = parsed.tps[("ch-a", "m1")]
    assert tps.count == 3
    assert tps.sum == 90
    assert parsed.plugin_errors["moderation"] == 2


def test_parse_prom_skips_bad_lines():
    from agenticx.ops.slo import parse_prom_text

    text = """
# comment

not_a_metric
agx_plugin_errors_total{plugin="x"}
agx_plugin_errors_total{plugin="ok"} 1
"""
    parsed = parse_prom_text(text)
    assert parsed.plugin_errors == {"ok": 1.0}
    assert parsed.ttft == {}


def test_parse_channel_stats_cooling_flags():
    from agenticx.ops.slo import parse_channel_stats

    stats = parse_channel_stats(STATS_FIXTURE)
    assert stats["ch-a"].cooling == "1"
    assert stats["ch-a"].cooldown_until == "2099-01-01T00:00:00Z"
    assert stats["ch-b"].cooling == "0"
    assert stats["ch-a"].last_error == "upstream timeout"


def test_parse_channel_stats_bad_json():
    from agenticx.ops.slo import parse_channel_stats

    assert parse_channel_stats("nope") == {}
    assert parse_channel_stats({"data": []}) == {}


def test_build_slo_rows_order_and_keys():
    from agenticx.ops.slo import PRESENT, build_slo_rows, parse_channel_stats, parse_prom_text

    rows = build_slo_rows(parse_prom_text(PROM_FIXTURE), parse_channel_stats(STATS_FIXTURE))
    assert [row.kind for row in rows] == ["ttft", "tps", "cooldown", "cooldown", "plugin_error"]
    ttft = next(row for row in rows if row.kind == "ttft")
    assert ttft.key == "ch-a|m1"
    assert ttft.value == "0.5"
    cool = {row.key: row for row in rows if row.kind == "cooldown"}
    assert cool["ch-a"].attrs["cooling"] == "1"
    assert cool["ch-b"].attrs["cooling"] == "0"
    assert cool["ch-b"].evidence == PRESENT


def test_build_slo_rows_filter_channel():
    from agenticx.ops.slo import build_slo_rows, parse_channel_stats, parse_prom_text

    parsed = parse_prom_text(PROM_FIXTURE)
    stats = parse_channel_stats(STATS_FIXTURE)
    rows = build_slo_rows(parsed, stats, channel="ch-b")
    assert [row.kind for row in rows] == ["cooldown"]
    assert rows[0].key == "ch-b"
    assert build_slo_rows(parsed, stats, channel="ch-z") == []


def test_build_slo_rows_does_not_use_health_gauge():
    from agenticx.ops.slo import build_slo_rows, parse_channel_stats, parse_prom_text

    rows = build_slo_rows(parse_prom_text(PROM_FIXTURE), parse_channel_stats(STATS_FIXTURE))
    dumped = json.dumps([row.__dict__ for row in rows])
    assert "agx_gateway_channel_health" not in dumped
    assert all(row.kind != "channel_health" for row in rows)
    cool = next(row for row in rows if row.kind == "cooldown" and row.key == "ch-a")
    assert cool.attrs["cooling"] == "1"
    assert cool.value == "2099-01-01T00:00:00Z"


def test_query_not_configured(monkeypatch):
    from agenticx.ops.slo import query_channel_slo

    monkeypatch.delenv("AGENTICX_GATEWAY_METRICS_FILE", raising=False)
    monkeypatch.delenv("AGENTICX_GATEWAY_METRICS_URL", raising=False)
    monkeypatch.delenv("AGENTICX_GATEWAY_CHANNEL_STATS_FILE", raising=False)
    monkeypatch.delenv("AGENTICX_GATEWAY_CHANNEL_STATS_URL", raising=False)
    result = query_channel_slo()
    assert result.reason == "not_configured"
    assert result.rows == []


def test_dispatch_get_channel_slo_from_files(tmp_path, monkeypatch):
    from agenticx.ops.tools import dispatch_ops_tool

    _use_slo_files(tmp_path, monkeypatch)
    monkeypatch.setenv("AGENTICX_GATEWAY_INTERNAL_TOKEN", "SECRET_SLO_TOKEN")
    raw = dispatch_ops_tool("get_channel_slo", {}, session=None)
    body = json.loads(raw)
    assert body["source"] == "slo"
    assert any(it.get("kind") == "ttft" and it.get("key") == "ch-a|m1" for it in body["items"])
    assert "SECRET_SLO_TOKEN" not in raw


def test_dispatch_file_wins_over_url(tmp_path, monkeypatch):
    from agenticx.ops.tools import dispatch_ops_tool

    _use_slo_files(tmp_path, monkeypatch)
    monkeypatch.setenv("AGENTICX_GATEWAY_METRICS_URL", "http://127.0.0.1:1/metrics")
    monkeypatch.setenv("AGENTICX_GATEWAY_CHANNEL_STATS_URL", "http://127.0.0.1:1/internal/channel-stats")
    raw = dispatch_ops_tool("get_channel_slo", {}, session=None)
    body = json.loads(raw)
    assert body["reason"] != "scrape_http_0"
    assert any(it.get("kind") == "ttft" for it in body["items"])


def test_get_channel_slo_description():
    from agenticx.ops.tools import OPS_TOOLS

    spec = next(t for t in OPS_TOOLS if t["function"]["name"] == "get_channel_slo")
    desc = spec["function"]["description"]
    assert "Read-only." in desc
    assert "Never invent" in desc
    assert "Missing is not a root cause" in desc
    assert "Not the health score" in desc
