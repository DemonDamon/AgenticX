"""Harness turn usage + end-of-turn tool progress for Near SSE."""

from __future__ import annotations

from agenticx.harness.usage import (
    usage_metadata_from_claude_result_usage,
    usage_metadata_from_harness_detail,
)


def test_usage_from_claude_result_usage_maps_cache_read() -> None:
    meta = usage_metadata_from_claude_result_usage(
        {
            "input_tokens": 120022,
            "output_tokens": 879,
            "cache_read_input_tokens": 144064,
        }
    )
    assert meta is not None
    assert meta["input_tokens"] == 120022
    assert meta["output_tokens"] == 879
    assert meta["cached_tokens"] == 144064
    assert meta["total_tokens"] == 120901


def test_usage_from_harness_detail_prefers_usage_metadata() -> None:
    meta = usage_metadata_from_harness_detail(
        {
            "mode": "headless",
            "usage_metadata": {
                "input_tokens": 10,
                "output_tokens": 3,
                "cached_tokens": 0,
                "total_tokens": 13,
            },
        }
    )
    assert meta == {
        "input_tokens": 10,
        "output_tokens": 3,
        "cached_tokens": 0,
        "reasoning_tokens": 0,
        "total_tokens": 13,
    }


def test_usage_from_codebuddy_usage_totals() -> None:
    meta = usage_metadata_from_harness_detail(
        {"usage_totals": {"input": 100, "output": 20, "cached": 5}}
    )
    assert meta is not None
    assert meta["input_tokens"] == 100
    assert meta["output_tokens"] == 20
    assert meta["cached_tokens"] == 5


def test_usage_none_when_empty() -> None:
    assert usage_metadata_from_claude_result_usage({}) is None
    assert usage_metadata_from_harness_detail({"mode": "headless"}) is None


def test_list_turn_tool_progress_snapshot_does_not_require_live_drain() -> None:
    """End-of-turn fallback sees tool_use/tool_result from watermarked lines."""
    from agenticx.cc_bridge.session_manager import BridgeSession, BridgeSessionManager
    from agenticx.harness.stream_json_text import ToolProgressTracker, VisibleTextTracker
    import json

    mgr = BridgeSessionManager()
    # Minimal in-memory session stub via start is heavy; call helper logic directly.
    lines = [
        json.dumps(
            {
                "type": "assistant",
                "message": {
                    "content": [
                        {"type": "tool_use", "id": "call_1", "name": "WebSearch", "input": {}}
                    ]
                },
            }
        ),
        json.dumps(
            {
                "type": "user",
                "message": {
                    "content": [
                        {"type": "tool_result", "tool_use_id": "call_1", "content": "ok"}
                    ]
                },
            }
        ),
    ]
    from agenticx.harness.stream_json_text import drain_midturn_items_from_lines

    items, _ = drain_midturn_items_from_lines(
        lines,
        start_index=0,
        text_tracker=VisibleTextTracker(),
        tool_tracker=ToolProgressTracker(),
    )
    kinds = [i.kind for i in items]
    assert kinds == ["tool_start", "tool_end"]
    assert items[0].name == "WebSearch"
