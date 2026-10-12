#!/usr/bin/env python3
"""Unit tests for the request_clarification HITL primitive.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List

import pytest

from agenticx.cli.agent_tools import (
    _normalize_clarification_decisions,
    _request_clarification,
    build_clarification_tool_result,
)
from agenticx.runtime.clarify import (
    AsyncClarifyGate,
    AutoSuspendClarifyGate,
)


def test_normalize_clarification_decisions_defaults_to_single() -> None:
    out = _normalize_clarification_decisions(
        [
            {
                "id": "tone",
                "question": "整体语气选择？",
                "options": ["专业克制", "轻松活泼"],
            }
        ]
    )
    assert out == [
        {
            "id": "tone",
            "question": "整体语气选择？",
            "options": ["专业克制", "轻松活泼"],
            "selection_mode": "single",
            "exclusive_options": [],
        }
    ]


def test_normalize_clarification_decisions_multiple_with_exclusive() -> None:
    out = _normalize_clarification_decisions(
        [
            {
                "id": "scope",
                "question": "系统提示是否需要调整？",
                "options": ["直接采用上面草案", "补充硬件监控", "补充模型架构设计"],
                "selection_mode": "multiple",
                "exclusive_options": ["直接采用上面草案"],
            }
        ]
    )
    assert out[0]["selection_mode"] == "multiple"
    assert out[0]["exclusive_options"] == ["直接采用上面草案"]


def test_normalize_clarification_decisions_unknown_mode_falls_back_to_single() -> None:
    out = _normalize_clarification_decisions(
        [
            {
                "question": "选一个",
                "options": ["A", "B"],
                "selection_mode": "multi",
                "exclusive_options": ["A"],
            }
        ]
    )
    assert out[0]["selection_mode"] == "single"
    assert out[0]["exclusive_options"] == []


def test_normalize_clarification_decisions_filters_invalid_exclusive_options() -> None:
    out = _normalize_clarification_decisions(
        [
            {
                "question": "选多个",
                "options": ["A", "B", "C"],
                "selection_mode": "multiple",
                "exclusive_options": ["A", "A", "  ", "Z", "B"],
            }
        ]
    )
    assert out[0]["selection_mode"] == "multiple"
    assert out[0]["exclusive_options"] == ["A", "B"]


def test_build_clarification_tool_result_with_options_and_text() -> None:
    out = build_clarification_tool_result(
        {"answer_text": "配色用深蓝紫+科技金", "selected_options": ["锁定 2 分钟"]}
    )
    assert "锁定 2 分钟" in out
    assert "配色用深蓝紫+科技金" in out
    assert out.endswith("。")


def test_build_clarification_tool_result_only_options() -> None:
    out = build_clarification_tool_result({"answer_text": "", "selected_options": ["A", "B"]})
    assert out == "用户选择：A；B。"


def test_build_clarification_tool_result_only_text() -> None:
    out = build_clarification_tool_result({"answer_text": "自由文本", "selected_options": []})
    assert out == "自定义补充：自由文本。"


def test_build_clarification_tool_result_empty() -> None:
    out = build_clarification_tool_result({"answer_text": "", "selected_options": []})
    assert "默认方案" in out


def test_build_clarification_tool_result_timeout_sentinel() -> None:
    out = build_clarification_tool_result({"__timeout__": True})
    assert out.startswith("[CLARIFICATION_TIMEOUT]")


def test_build_clarification_tool_result_suspended_sentinel() -> None:
    out = build_clarification_tool_result({"__suspended__": True})
    assert out.startswith("[CLARIFICATION_PENDING]")


def test_async_clarify_gate_resolve_returns_structured_answer() -> None:
    gate = AsyncClarifyGate(timeout_seconds=5.0)

    async def _resolve_after() -> None:
        await asyncio.sleep(0.05)
        gate.resolve("req-1", {"answer_text": "hi", "selected_options": ["ok"]})

    async def _main() -> Dict[str, Any]:
        task = asyncio.create_task(_resolve_after())
        answer = await gate.request_clarification(
            "pick one", options=["ok"], allow_free_text=True, context={"request_id": "req-1"}
        )
        await task
        return answer

    answer = asyncio.run(_main())
    assert answer == {"answer_text": "hi", "selected_options": ["ok"]}


def test_async_clarify_gate_resolve_idempotent() -> None:
    gate = AsyncClarifyGate(timeout_seconds=5.0)

    async def _main() -> None:
        fut = asyncio.get_running_loop().create_future()
        gate._pending["req-x"] = fut
        assert gate.resolve("req-x", {"answer_text": "a"}) is True
        # Second resolve on the same (still-pending) future must be a no-op.
        assert gate.resolve("req-x", {"answer_text": "b"}) is False
        assert not fut.done() or fut.result() == {"answer_text": "a"}

    asyncio.run(_main())


def test_async_clarify_gate_timeout_returns_sentinel() -> None:
    gate = AsyncClarifyGate(timeout_seconds=0.05)

    async def _main() -> Dict[str, Any]:
        return await gate.request_clarification(
            "no one will answer", options=[], allow_free_text=True
        )

    answer = asyncio.run(_main())
    assert answer.get("__timeout__") is True


def test_auto_suspend_clarify_gate_returns_suspended_immediately() -> None:
    gate = AutoSuspendClarifyGate()

    async def _main() -> Dict[str, Any]:
        return await gate.request_clarification("q", options=["a"], allow_free_text=True)

    answer = asyncio.run(_main())
    assert answer.get("__suspended__") is True


def test_request_clarification_unattended_emits_suspended_and_returns_sentinel() -> None:
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)

    async def _main() -> str:
        return await _request_clarification(
            "plan sign-off?",
            options=["lock 2min"],
            allow_free_text=True,
            context=None,
            clarify_gate=AsyncClarifyGate(timeout_seconds=1.0),
            emit_event=emit,
            is_unattended=True,
        )

    result = asyncio.run(_main())
    assert result.startswith("[CLARIFICATION_PENDING]")
    assert any(e["type"] == "clarification_suspended" for e in events)


def test_request_clarification_auto_suspend_gate_returns_sentinel() -> None:
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)

    async def _main() -> str:
        return await _request_clarification(
            "q",
            options=[],
            allow_free_text=False,
            clarify_gate=AutoSuspendClarifyGate(),
            emit_event=emit,
            is_unattended=False,
        )

    result = asyncio.run(_main())
    assert result.startswith("[CLARIFICATION_PENDING]")
    suspended = next(e for e in events if e["type"] == "clarification_suspended")
    assert suspended["data"]["options"] == []
    assert suspended["data"]["decisions"] == []
    assert suspended["data"]["allow_free_text"] is True


def test_request_clarification_normal_round_trip() -> None:
    gate = AsyncClarifyGate(timeout_seconds=5.0)
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)

    async def _resolve_after() -> None:
        await asyncio.sleep(0.05)
        gate.resolve("req-rt", {"answer_text": "ok", "selected_options": ["A"]})

    async def _main() -> str:
        task = asyncio.create_task(_resolve_after())
        result = await _request_clarification(
            "choose",
            options=["A", "B"],
            allow_free_text=True,
            context={"request_id": "req-rt"},
            clarify_gate=gate,
            emit_event=emit,
            is_unattended=False,
        )
        await task
        return result

    result = asyncio.run(_main())
    assert "A" in result
    assert "ok" in result
    types = [e["type"] for e in events]
    assert "clarification_required" in types
    assert "clarification_response" in types


def test_request_clarification_fast_submit_during_emit_keeps_answer() -> None:
    """UI may POST /api/clarify as soon as clarification_required is emitted.

    The pending future must already be registered, otherwise resolve() is a
    no-op and the tool result becomes CLARIFICATION_TIMEOUT (issue #32).
    """
    gate = AsyncClarifyGate(timeout_seconds=1.0)
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)
        if evt.get("type") != "clarification_required":
            return
        req_id = str((evt.get("data") or {}).get("id") or "")
        accepted = gate.resolve(
            req_id,
            {"answer_text": "https://github.com/acme/repo", "selected_options": []},
        )
        assert accepted is True

    async def _main() -> str:
        return await _request_clarification(
            "仓库链接？",
            options=[],
            allow_free_text=True,
            context={"request_id": "req-fast"},
            clarify_gate=gate,
            emit_event=emit,
            is_unattended=False,
        )

    result = asyncio.run(_main())
    assert "https://github.com/acme/repo" in result
    assert not result.startswith("[CLARIFICATION_TIMEOUT]")
    assert [e["type"] for e in events] == [
        "clarification_required",
        "clarification_response",
    ]


def test_request_clarification_timeout_returns_sentinel() -> None:
    gate = AsyncClarifyGate(timeout_seconds=0.05)
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)

    async def _main() -> str:
        return await _request_clarification(
            "q",
            options=[],
            allow_free_text=True,
            clarify_gate=gate,
            emit_event=emit,
            is_unattended=False,
        )

    result = asyncio.run(_main())
    assert result.startswith("[CLARIFICATION_TIMEOUT]")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])


# ---------------------------------------------------------------------------
# Form-style decisions (connector assistant): text/url fields, custom option,
# required flag, button labels and secret redaction.
# ---------------------------------------------------------------------------


def test_normalize_form_decisions_url_field_and_custom_option() -> None:
    out = _normalize_clarification_decisions(
        [
            {
                "id": "system_type",
                "question": "abc 要接入的是什么类型的系统？",
                "options": ["REST API", "MCP Server", "其他（自定义输入）"],
                "custom_option": "其他（自定义输入）",
            },
            {
                "id": "upstream_url",
                "question": "请提供上游服务地址",
                "input_type": "url",
                "label": "上游地址",
                "placeholder": "https://example.com/mcp",
            },
            {"id": "note", "question": "备注", "input_type": "text", "required": False},
        ]
    )
    assert out[0]["custom_option"] == "其他（自定义输入）"
    assert "input_type" not in out[0]
    assert out[1] == {
        "id": "upstream_url",
        "question": "请提供上游服务地址",
        "options": [],
        "selection_mode": "single",
        "exclusive_options": [],
        "input_type": "url",
        "label": "上游地址",
        "placeholder": "https://example.com/mcp",
    }
    assert out[2]["required"] is False and out[2]["input_type"] == "text"


def test_normalize_form_decisions_rejects_secret_and_bad_custom_option() -> None:
    out = _normalize_clarification_decisions(
        [
            {"question": "token?", "input_type": "secret"},
            {"question": "pick", "options": ["A"], "custom_option": "B"},
        ]
    )
    # secret is internal-only → falls back to choice and, with no options, is dropped.
    assert len(out) == 1
    assert "custom_option" not in out[0]
    internal = _normalize_clarification_decisions(
        [{"id": "credential", "question": "token?", "input_type": "secret", "options": ["x"]}],
        allow_secret=True,
    )
    assert internal[0]["input_type"] == "secret" and internal[0]["options"] == []


def test_request_clarification_redacts_secret_values_from_result_and_events() -> None:
    gate = AsyncClarifyGate(timeout_seconds=5)
    events: List[Dict[str, Any]] = []

    async def emit(evt: Dict[str, Any]) -> None:
        events.append(evt)
        if evt["type"] == "clarification_required":
            gate.resolve(
                evt["data"]["id"],
                {"answer_text": "", "selected_options": ["地址：https://x"], "secret_values": {"k": "TOPSECRET"}},
            )

    async def run() -> str:
        return await _request_clarification(
            "q",
            decisions=_normalize_clarification_decisions(
                [{"id": "u", "question": "地址", "input_type": "url"}]
            ),
            clarify_gate=gate,
            emit_event=emit,
        )

    text = asyncio.run(run())
    assert "TOPSECRET" not in text
    assert "TOPSECRET" not in str(events)
    assert "地址：https://x" in text


def test_dispatch_request_clarification_passes_button_labels() -> None:
    from agenticx.cli.agent_tools import dispatch_tool_async

    gate = AsyncClarifyGate(timeout_seconds=5)
    seen: Dict[str, Any] = {}

    async def emit(evt: Dict[str, Any]) -> None:
        if evt["type"] == "clarification_required":
            seen.update(evt["data"])
            gate.resolve(evt["data"]["id"], {"answer_text": "", "selected_options": []})

    class _S:
        context_files: Dict[str, str] = {}

    async def run() -> str:
        return await dispatch_tool_async(
            "request_clarification",
            {
                "prompt": "p",
                "decisions": [{"question": "地址", "input_type": "url"}],
                "submit_label": "确认",
                "skip_label": "忽略",
            },
            _S(),  # type: ignore[arg-type]
            clarify_gate=gate,
            event_callback=emit,
        )

    asyncio.run(run())
    assert seen["context"]["submit_label"] == "确认"
    assert seen["context"]["skip_label"] == "忽略"
    assert seen["decisions"][0]["input_type"] == "url"
