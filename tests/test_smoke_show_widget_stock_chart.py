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
