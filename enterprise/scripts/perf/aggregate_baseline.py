#!/usr/bin/env python3
"""Merge k6 --summary-export JSON files into one perf baseline artifact."""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def load_summary(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def metric_value(metrics: dict[str, Any], name: str, stat: str) -> float | None:
    entry = metrics.get(name)
    if not entry:
        return None
    values = entry.get("values") or {}
    if stat in values:
        return values[stat]
    return entry.get(stat)


def extract_case(name: str, summary: dict[str, Any]) -> dict[str, Any]:
    metrics = summary.get("metrics") or {}
    http_duration = metrics.get("http_req_duration") or {}
    http_failed = metrics.get("http_req_failed") or {}
    http_count = metrics.get("http_reqs") or {}
    return {
        "name": name,
        "http_reqs": metric_value(metrics, "http_reqs", "count"),
        "req_per_s": metric_value(metrics, "http_reqs", "rate"),
        "duration_ms": {
            "p50": metric_value(metrics, "http_req_duration", "p(50)"),
            "p95": metric_value(metrics, "http_req_duration", "p(95)"),
            "p99": metric_value(metrics, "http_req_duration", "p(99)"),
            "avg": metric_value(metrics, "http_req_duration", "avg"),
            "max": metric_value(metrics, "http_req_duration", "max"),
        },
        "error_rate": metric_value(metrics, "http_req_failed", "rate"),
        "raw_metric_keys": sorted(metrics.keys()),
        "root_group": summary.get("root_group"),
        "http_req_duration_meta": http_duration,
        "http_req_failed_meta": http_failed,
        "http_reqs_meta": http_count,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--timestamp", required=True)
    parser.add_argument("--host", required=True)
    parser.add_argument("--os", dest="os_info", required=True)
    parser.add_argument("--cpu", required=True)
    parser.add_argument("--mock-delay-ms", type=int, required=True)
    parser.add_argument("--gateway-addr", required=True)
    parser.add_argument("--mock-addr", required=True)
    parser.add_argument("--vus", type=int, required=True)
    parser.add_argument("--duration", required=True)
    parser.add_argument("--kind", default="gateway-chat-perf-baseline")
    parser.add_argument("summaries", nargs="+")
    args = parser.parse_args()

    cases = []
    for raw in args.summaries:
        path = Path(raw)
        cases.append(extract_case(path.stem, load_summary(path)))

    payload = {
        "kind": args.kind,
        "generated_at": args.timestamp,
        "git_commit": args.commit,
        "environment": {
            "host": args.host,
            "os": args.os_info,
            "cpu": args.cpu,
            "gateway_addr": args.gateway_addr,
            "mock_upstream_addr": args.mock_addr,
            "mock_upstream_delay_ms": args.mock_delay_ms,
            "k6_vus": args.vus,
            "k6_duration": args.duration,
            "notes": "mock upstream isolates gateway overhead; not a production SLA measurement",
        },
        "cases": cases,
    }

    out = Path(args.output)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w", encoding="utf-8") as fh:
        json.dump(payload, fh, indent=2, ensure_ascii=False)
        fh.write("\n")
    print(out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
