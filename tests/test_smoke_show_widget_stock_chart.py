"""Smoke tests for show_widget stock_chart structured payload pass-through."""

from __future__ import annotations

import json

from agenticx.cli.agent_tools import _tool_show_widget


def test_show_widget_passes_stock_chart_json_through():
    widget_code = json.dumps(
        {
            "type": "stock_chart",
            "title": "603678.SH",
            "chart_type": "candlestick",
            "points": [
                {"date": "2026-07-01", "open": 80, "high": 90, "low": 78, "close": 85},
            ],
            "attribution": "数据来源：AkShare",
        },
        ensure_ascii=False,
    )
    result = _tool_show_widget({"title": "ignored", "widget_code": widget_code})
    parsed = json.loads(result)
    assert parsed["type"] == "stock_chart"
    assert parsed["attribution"] == "数据来源：AkShare"


def test_show_widget_infers_stock_chart_type_when_missing_watchlist():
    """Regression: model emitted watchlist JSON without the literal "type" key.

    Previously this degraded to a raw-JSON HTML widget (unreadable text block).
    """
    widget_code = json.dumps(
        {
            "chart_type": "candlestick",
            "watchlist": [
                {
                    "symbol": "603678",
                    "name": "火炬电子",
                    "data": [
                        {"date": "2026-07-03", "open": 81.26, "high": 89.4, "low": 77.93, "close": 85.48},
                    ],
                },
            ],
        },
        ensure_ascii=False,
    )
    result = _tool_show_widget({"title": "ignored", "widget_code": widget_code})
    parsed = json.loads(result)
    assert parsed["type"] == "stock_chart"
    assert parsed["watchlist"][0]["symbol"] == "603678"


def test_show_widget_infers_stock_chart_type_when_missing_single_points():
    widget_code = json.dumps(
        {
            "chart_type": "candlestick",
            "points": [
                {"date": "2026-07-03", "open": 81.26, "high": 89.4, "low": 77.93, "close": 85.48},
            ],
        },
        ensure_ascii=False,
    )
    result = _tool_show_widget({"title": "ignored", "widget_code": widget_code})
    parsed = json.loads(result)
    assert parsed["type"] == "stock_chart"


def test_show_widget_wraps_regular_html_widget():
    result = _tool_show_widget(
        {
            "title": "demo",
            "widget_code": "<div>hello</div>",
        }
    )
    parsed = json.loads(result)
    assert parsed["type"] == "widget"
    assert parsed["widget_code"] == "<div>hello</div>"


def test_show_widget_preserves_declared_mermaid_format():
    result = _tool_show_widget(
        {
            "title": "流程",
            "widget_format": "mermaid",
            "widget_code": "flowchart LR\n  A --> B",
        }
    )
    parsed = json.loads(result)
    assert parsed["type"] == "widget"
    assert parsed["widget_format"] == "mermaid"
    assert parsed["widget_code"].startswith("flowchart")


def test_show_widget_rejects_unknown_widget_format():
    result = _tool_show_widget(
        {
            "title": "流程",
            "widget_format": "canvas",
            "widget_code": "anything",
        }
    )
    assert result == (
        "ERROR: show_widget widget_format must be one of: svg, html, mermaid."
    )


def test_show_widget_keeps_legacy_payload_without_format():
    result = _tool_show_widget(
        {"title": "legacy", "widget_code": "<svg viewBox='0 0 10 10'></svg>"}
    )
    parsed = json.loads(result)
    assert "widget_format" not in parsed
