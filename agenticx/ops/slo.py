"""Read-only channel SLO query (TTFT / TPS / cooldown / plugin errors).

Author: Damon Li
"""

from __future__ import annotations

import json
import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

PRESENT = "present"
MISSING = "missing"

SLO_KINDS = ("ttft", "tps", "cooldown", "plugin_error")

METRIC_TTFT = "agx_gateway_ttft_seconds"
METRIC_TPS = "agx_gateway_tokens_per_second"
METRIC_PLUGIN_ERRORS = "agx_plugin_errors_total"

ENV_METRICS_FILE = "AGENTICX_GATEWAY_METRICS_FILE"
ENV_METRICS_URL = "AGENTICX_GATEWAY_METRICS_URL"
ENV_STATS_FILE = "AGENTICX_GATEWAY_CHANNEL_STATS_FILE"
ENV_STATS_URL = "AGENTICX_GATEWAY_CHANNEL_STATS_URL"
ENV_INTERNAL_TOKEN = "AGENTICX_GATEWAY_INTERNAL_TOKEN"

_PROM_LINE = re.compile(
    r"^([a-zA-Z_:][a-zA-Z0-9_:]*)"
    r"(?:\{([^}]*)\})?"
    r"\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)\s*$"
)
_PROM_LABEL = re.compile(r'([a-zA-Z_][a-zA-Z0-9_]*)="((?:\\.|[^"\\])*)"')
_SUMMARY_MAX = 128


@dataclass
class SloRow:
    kind: str
    key: str
    name: str
    evidence: str = MISSING
    value: str = ""
    unit: str = ""
    status: str = "missing"
    summary: str = ""
    channel: str = ""
    model: str = ""
    plugin: str = ""
    attrs: dict[str, str] = field(default_factory=dict)


@dataclass
class SloQueryResult:
    rows: list[SloRow] = field(default_factory=list)
    reason: str = ""


@dataclass
class HistogramAgg:
    channel: str
    model: str
    sum: float = 0.0
    count: float = 0.0


@dataclass
class ParsedMetrics:
    ttft: dict[tuple[str, str], HistogramAgg] = field(default_factory=dict)
    tps: dict[tuple[str, str], HistogramAgg] = field(default_factory=dict)
    plugin_errors: dict[str, float] = field(default_factory=dict)


@dataclass
class ChannelStat:
    channel: str
    cooling: str = "0"
    cooldown_until: str = ""
    last_error: str = ""
    success_count: str = ""
    failure_count: str = ""


def _clip(text: str, limit: int) -> str:
    encoded = text.encode("utf-8")
    if len(encoded) <= limit:
        return text
    return encoded[:limit].decode("utf-8", errors="ignore")


def _env(name: str) -> str:
    return os.environ.get(name, "").strip()


def _label_value(raw: str) -> str:
    return raw.replace(r"\"", '"')


def _parse_labels(raw: str | None) -> dict[str, str]:
    if not raw:
        return {}
    out: dict[str, str] = {}
    for match in _PROM_LABEL.finditer(raw):
        out[match.group(1)] = _label_value(match.group(2))
    return out


def _dim(labels: dict[str, str], key: str) -> str:
    value = str(labels.get(key) or "").strip()
    return value or "unknown"


def _ensure_hist(
    store: dict[tuple[str, str], HistogramAgg], channel: str, model: str
) -> HistogramAgg:
    key = (channel, model)
    agg = store.get(key)
    if agg is None:
        agg = HistogramAgg(channel=channel, model=model)
        store[key] = agg
    return agg


def parse_prom_text(text: str) -> ParsedMetrics:
    parsed = ParsedMetrics()
    for raw_line in str(text or "").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        match = _PROM_LINE.match(line)
        if match is None:
            continue
        name = match.group(1)
        labels = _parse_labels(match.group(2))
        try:
            number = float(match.group(3))
        except (TypeError, ValueError):
            continue
        if name == METRIC_PLUGIN_ERRORS:
            plugin = _dim(labels, "plugin")
            parsed.plugin_errors[plugin] = parsed.plugin_errors.get(plugin, 0.0) + number
            continue
        if name.startswith(f"{METRIC_TTFT}_"):
            suffix = name[len(METRIC_TTFT) + 1 :]
            if suffix not in {"sum", "count"}:
                continue
            agg = _ensure_hist(parsed.ttft, _dim(labels, "channel"), _dim(labels, "model"))
            if suffix == "sum":
                agg.sum += number
            else:
                agg.count += number
            continue
        if name.startswith(f"{METRIC_TPS}_"):
            suffix = name[len(METRIC_TPS) + 1 :]
            if suffix not in {"sum", "count"}:
                continue
            agg = _ensure_hist(parsed.tps, _dim(labels, "channel"), _dim(labels, "model"))
            if suffix == "sum":
                agg.sum += number
            else:
                agg.count += number
    return parsed


def _copy_count_attr(item: dict, key: str) -> str:
    raw = item.get(key)
    if raw is None or raw == "":
        return ""
    try:
        return str(int(raw))
    except (TypeError, ValueError):
        try:
            return str(int(float(raw)))
        except (TypeError, ValueError):
            return ""


def parse_channel_stats(raw: object) -> dict[str, ChannelStat]:
    obj: Any = raw
    if isinstance(raw, str):
        try:
            obj = json.loads(raw)
        except json.JSONDecodeError:
            return {}
    if not isinstance(obj, dict):
        return {}
    nested = obj.get("data")
    stats: Any
    if isinstance(nested, dict) and isinstance(nested.get("stats"), dict):
        stats = nested.get("stats")
    elif isinstance(obj.get("stats"), dict):
        stats = obj.get("stats")
    else:
        return {}
    if not isinstance(stats, dict):
        return {}
    out: dict[str, ChannelStat] = {}
    for channel_id, item in stats.items():
        channel = str(channel_id or "").strip()
        if not channel or not isinstance(item, dict):
            continue
        until_raw = item.get("cooldown_until")
        until = str(until_raw).strip() if until_raw not in (None, "") else ""
        last_error = _clip(str(item.get("last_error") or ""), _SUMMARY_MAX)
        out[channel] = ChannelStat(
            channel=channel,
            cooling="1" if until else "0",
            cooldown_until=until,
            last_error=last_error,
            success_count=_copy_count_attr(item, "success_count"),
            failure_count=_copy_count_attr(item, "failure_count"),
        )
    return out


def _row_status(evidence: str) -> str:
    return "ok" if evidence == PRESENT else "missing"


def _summary(
    kind: str,
    status: str,
    *,
    channel: str = "",
    model: str = "",
    plugin: str = "",
) -> str:
    parts = [kind, status]
    if channel:
        parts.append(f"channel={channel}")
    if model:
        parts.append(f"model={model}")
    if plugin:
        parts.append(f"plugin={plugin}")
    return _clip(" ".join(parts), _SUMMARY_MAX)


def _fmt_mean(total: float, count: float) -> str:
    return f"{(total / count):.6g}"


def _fmt_count(number: float) -> str:
    if number.is_integer():
        return str(int(number))
    return f"{number:.6g}"


def _keep(channel: str, model: str, plugin: str, want_channel: str, want_model: str, want_plugin: str) -> bool:
    if want_channel and channel != want_channel:
        return False
    if want_model and model != want_model:
        return False
    if want_plugin and plugin != want_plugin:
        return False
    return True


def _present_row(
    *,
    kind: str,
    key: str,
    name: str,
    value: str,
    unit: str,
    channel: str = "",
    model: str = "",
    plugin: str = "",
    attrs: dict[str, str] | None = None,
) -> SloRow:
    status = _row_status(PRESENT)
    return SloRow(
        kind=kind,
        key=key,
        name=name,
        evidence=PRESENT,
        value=value,
        unit=unit,
        status=status,
        summary=_summary(kind, status, channel=channel, model=model, plugin=plugin),
        channel=channel,
        model=model,
        plugin=plugin,
        attrs=attrs or {},
    )


def build_slo_rows(
    metrics: ParsedMetrics | None,
    stats: dict[str, ChannelStat] | None,
    *,
    channel: str = "",
    model: str = "",
    plugin: str = "",
) -> list[SloRow]:
    parsed = metrics or ParsedMetrics()
    channel_stats = stats or {}
    want_channel = str(channel or "").strip()
    want_model = str(model or "").strip()
    want_plugin = str(plugin or "").strip()
    rows: list[SloRow] = []

    ttft_rows: list[SloRow] = []
    for key in sorted(parsed.ttft):
        agg = parsed.ttft[key]
        if agg.count <= 0:
            continue
        if not _keep(agg.channel, agg.model, "", want_channel, want_model, want_plugin):
            continue
        ttft_rows.append(
            _present_row(
                kind="ttft",
                key=f"{agg.channel}|{agg.model}",
                name="ttft",
                value=_fmt_mean(agg.sum, agg.count),
                unit="s",
                channel=agg.channel,
                model=agg.model,
            )
        )
    rows.extend(ttft_rows)

    tps_rows: list[SloRow] = []
    for key in sorted(parsed.tps):
        agg = parsed.tps[key]
        if agg.count <= 0:
            continue
        if not _keep(agg.channel, agg.model, "", want_channel, want_model, want_plugin):
            continue
        tps_rows.append(
            _present_row(
                kind="tps",
                key=f"{agg.channel}|{agg.model}",
                name="tps",
                value=_fmt_mean(agg.sum, agg.count),
                unit="tps",
                channel=agg.channel,
                model=agg.model,
            )
        )
    rows.extend(tps_rows)

    cooldown_rows: list[SloRow] = []
    for key in sorted(channel_stats):
        stat = channel_stats[key]
        if not _keep(stat.channel, "", "", want_channel, want_model, want_plugin):
            continue
        attrs = {
            "cooling": stat.cooling,
            "last_error": _clip(stat.last_error, _SUMMARY_MAX),
        }
        if stat.success_count:
            attrs["success_count"] = stat.success_count
        if stat.failure_count:
            attrs["failure_count"] = stat.failure_count
        cooldown_rows.append(
            _present_row(
                kind="cooldown",
                key=stat.channel,
                name="cooldown",
                value=stat.cooldown_until,
                unit="",
                channel=stat.channel,
                attrs=attrs,
            )
        )
    rows.extend(cooldown_rows)

    plugin_rows: list[SloRow] = []
    for plugin_name in sorted(parsed.plugin_errors):
        if not _keep("", "", plugin_name, want_channel, want_model, want_plugin):
            continue
        plugin_rows.append(
            _present_row(
                kind="plugin_error",
                key=plugin_name,
                name="plugin_error",
                value=_fmt_count(parsed.plugin_errors[plugin_name]),
                unit="count",
                plugin=plugin_name,
            )
        )
    rows.extend(plugin_rows)
    return rows


def _http_get(url: str, headers: dict[str, str] | None = None) -> tuple[str, str]:
    req = Request(url, headers=headers or {"Accept": "text/plain"}, method="GET")
    try:
        with urlopen(req, timeout=3) as resp:
            status = int(getattr(resp, "status", 200) or 200)
            body = resp.read()
    except HTTPError as exc:
        return "", f"scrape_http_{exc.code}"
    except (URLError, TimeoutError, OSError, ValueError):
        return "", "scrape_http_0"
    if status != 200:
        return "", f"scrape_http_{status}"
    try:
        return body.decode("utf-8"), ""
    except UnicodeDecodeError:
        return "", "scrape_http_200"


def load_metrics_text() -> tuple[str, str]:
    file_raw = _env(ENV_METRICS_FILE)
    if file_raw:
        path = Path(file_raw)
        if not path.is_file():
            return "", "scrape_file"
        try:
            return path.read_text(encoding="utf-8"), ""
        except (OSError, UnicodeDecodeError):
            return "", "scrape_file"
    url = _env(ENV_METRICS_URL)
    if not url:
        return "", "not_configured"
    return _http_get(url, {"Accept": "text/plain"})


def load_channel_stats_obj() -> tuple[dict, str]:
    file_raw = _env(ENV_STATS_FILE)
    if file_raw:
        path = Path(file_raw)
        if not path.is_file():
            return {}, "scrape_file"
        try:
            obj = json.loads(path.read_text(encoding="utf-8"))
        except (OSError, UnicodeDecodeError, json.JSONDecodeError):
            return {}, "scrape_file"
        if not isinstance(obj, dict):
            return {}, "scrape_file"
        return obj, ""
    url = _env(ENV_STATS_URL)
    if not url:
        return {}, "not_configured"
    headers = {"Accept": "application/json"}
    token = _env(ENV_INTERNAL_TOKEN)
    if token:
        headers["Authorization"] = f"Bearer {token}"
    text, reason = _http_get(url, headers)
    if reason:
        return {}, reason
    try:
        obj = json.loads(text)
    except json.JSONDecodeError:
        return {}, "scrape_http_200"
    if not isinstance(obj, dict):
        return {}, "scrape_http_200"
    return obj, ""


def query_channel_slo(
    channel: str = "",
    model: str = "",
    plugin: str = "",
) -> SloQueryResult:
    metrics_configured = bool(_env(ENV_METRICS_FILE) or _env(ENV_METRICS_URL))
    stats_configured = bool(_env(ENV_STATS_FILE) or _env(ENV_STATS_URL))
    if not metrics_configured and not stats_configured:
        return SloQueryResult(rows=[], reason="not_configured")
    text, m_reason = load_metrics_text() if metrics_configured else ("", "")
    obj, s_reason = load_channel_stats_obj() if stats_configured else ({}, "")
    rows = build_slo_rows(
        parse_prom_text(text),
        parse_channel_stats(obj),
        channel=channel,
        model=model,
        plugin=plugin,
    )
    if rows:
        return SloQueryResult(rows=rows, reason="")
    return SloQueryResult(rows=[], reason=m_reason or s_reason or "scrape_empty")
