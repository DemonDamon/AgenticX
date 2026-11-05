#!/usr/bin/env python3
"""Unit tests for mid-turn stream-json text + tool-progress extraction.

Author: Damon Li
"""

from __future__ import annotations

import json
import threading
import time
import uuid
from types import SimpleNamespace

from agenticx.cc_bridge.session_manager import BridgeSession, BridgeSessionManager
from agenticx.harness.stream_json_text import (
    ToolProgressTracker,
    VisibleTextTracker,
    drain_midturn_items_from_lines,
    drain_visible_text_from_lines,
    iter_raw_text_fragments,
    iter_raw_tool_progress,
)
from agenticx.wb_bridge.session_manager import WbBridgeSession, WbBridgeSessionManager


def _delta_line(text: str) -> str:
    return json.dumps(
        {
            "type": "stream_event",
            "event": {
                "type": "content_block_delta",
                "index": 0,
                "delta": {"type": "text_delta", "text": text},
            },
        },
        ensure_ascii=False,
    )


def _assistant_line(text: str) -> str:
    return json.dumps(
        {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [{"type": "text", "text": text}],
            },
        },
        ensure_ascii=False,
    )


def _tool_line() -> str:
    return json.dumps(
        {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": "t1",
                        "name": "Bash",
                        "input": {"command": "ls"},
                    }
                ],
            },
        },
        ensure_ascii=False,
    )


def _tool_start_stream_event(tool_id: str = "t1", name: str = "WebSearch") -> str:
    return json.dumps(
        {
            "type": "stream_event",
            "event": {
                "type": "content_block_start",
                "index": 1,
                "content_block": {
                    "type": "tool_use",
                    "id": tool_id,
                    "name": name,
                    "input": {},
                },
            },
        },
        ensure_ascii=False,
    )


def _tool_result_line(
    tool_id: str = "t1",
    *,
    is_error: bool = False,
    content: str = "ok",
) -> str:
    return json.dumps(
        {
            "type": "user",
            "message": {
                "role": "user",
                "content": [
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_id,
                        "content": content,
                        "is_error": is_error,
                    }
                ],
            },
        },
        ensure_ascii=False,
    )


def _result_line(text: str) -> str:
    return json.dumps(
        {
            "type": "result",
            "subtype": "success",
            "is_error": False,
            "result": text,
        },
        ensure_ascii=False,
    )


def test_iter_extracts_text_delta_and_skips_tool_use() -> None:
    frags = list(iter_raw_text_fragments(_delta_line("Hel")))
    assert frags == ["Hel"]
    assert list(iter_raw_text_fragments(_tool_line())) == []
    assert list(iter_raw_text_fragments(_result_line("final"))) == []
    assert list(iter_raw_text_fragments(_assistant_line("hi"))) == ["hi"]


def test_tracker_holds_thinking_until_close_then_emits_visible() -> None:
    tracker = VisibleTextTracker()
    # Bare thinking (no open tag) must not leak before </think>.
    assert tracker.feed("The user asked me a question.") == ""
    assert tracker.emitted == ""
    assert tracker.feed("</think>你好") == "你好"
    assert tracker.feed("，世界") == "，世界"
    assert tracker.emitted == "你好，世界"


def test_tracker_holds_tagged_think_until_close() -> None:
    tracker = VisibleTextTracker()
    assert tracker.feed("planning… <think>secret") == ""
    assert tracker.feed("</think>你好") == "你好"


def test_tracker_release_on_assistant_without_think_tags() -> None:
    tracker = VisibleTextTracker()
    assert tracker.feed("你好") == ""  # deltas held until release/close
    assert tracker.feed("你好", release=True) == "你好"
    # Replay of the same assistant text is a no-op.
    assert tracker.feed("你好", release=True) == ""
    assert tracker.feed("你好！", release=True) == "！"


def test_tracker_dedupes_assistant_replay_after_deltas() -> None:
    tracker = VisibleTextTracker()
    assert tracker.feed("thinking...") == ""
    assert tracker.feed("</think>你好") == "你好"
    # Full assistant block repeats the same visible text after partials.
    assert tracker.feed("你好", release=True) == ""
    assert tracker.feed("你好！", release=True) == "！"


def test_drain_lines_with_partials_then_result_watermark_ok() -> None:
    lines = [
        '{"type":"system","subtype":"init"}',
        _delta_line("答"),
        _delta_line("案"),
        _assistant_line("答案"),
        _result_line("答案"),
    ]
    tracker = VisibleTextTracker()
    delta, idx = drain_visible_text_from_lines(lines, start_index=1, tracker=tracker)
    assert delta == "答案"
    assert idx == len(lines)
    # Second drain yields nothing (cursor advanced).
    delta2, idx2 = drain_visible_text_from_lines(
        lines, start_index=idx, tracker=tracker
    )
    assert delta2 == ""
    assert idx2 == len(lines)


class _FakeProc:
    def __init__(self) -> None:
        self.stdin = SimpleNamespace(write=lambda *_a, **_k: None, flush=lambda: None)
        self._code = None

    def poll(self):
        return self._code

    def wait(self, timeout=None):
        self._code = 0
        return 0

    def terminate(self) -> None:
        self._code = 0

    def kill(self) -> None:
        self._code = 0


def test_cc_drain_ignores_prior_turn_and_streams_new_partials() -> None:
    mgr = BridgeSessionManager()
    sid = str(uuid.uuid4())
    session = BridgeSession(session_id=sid, cwd="/tmp", proc=_FakeProc())
    session.append_line(_assistant_line("旧答案"))
    session.append_line(_result_line("旧答案"))
    with mgr._global_lock:
        mgr._sessions[sid] = session

    # Before send: drain must be inert (no generation armed).
    assert mgr.drain_visible_stream_text(sid) == ""

    mgr.send_user_message(sid, "下一问")
    assert session._result_wait_watermark == 2
    assert mgr.drain_visible_stream_text(sid) == ""

    session.append_line(_delta_line("新"))
    session.append_line(_delta_line("答"))
    # Deltas alone stay buffered until think-close / assistant / block_stop.
    assert mgr.drain_visible_stream_text(sid) == ""
    session.append_line(_assistant_line("新答"))
    assert mgr.drain_visible_stream_text(sid) == "新答"
    assert mgr.drain_visible_stream_text(sid) == ""

    # Final result text still comes from wait_for_success_result path.
    session.append_line(_result_line("新答"))
    ok, _ = mgr.wait_for_success_result(sid, 1.0, poll_interval=0.05)
    assert ok is True


def test_cc_followup_watermark_still_blocks_prior_result_replay() -> None:
    mgr = BridgeSessionManager()
    sid = str(uuid.uuid4())
    session = BridgeSession(session_id=sid, cwd="/tmp", proc=_FakeProc())
    session.append_line(_result_line("第一轮"))
    with mgr._global_lock:
        mgr._sessions[sid] = session

    mgr.send_user_message(sid, "第二轮")
    # Mid-turn partials for turn 2 (release via assistant block).
    session.append_line(_delta_line("第二"))
    session.append_line(_assistant_line("第二"))
    assert "第二" in mgr.drain_visible_stream_text(sid)

    ok_early, _ = mgr.wait_for_success_result(sid, 0.25, poll_interval=0.05)
    assert ok_early is False

    def _late() -> None:
        time.sleep(0.08)
        session.append_line(_result_line("第二轮答案"))

    threading.Thread(target=_late, daemon=True).start()
    ok, _ = mgr.wait_for_success_result(sid, 2.0, poll_interval=0.05)
    assert ok is True


def test_wb_drain_streams_assistant_text_after_send() -> None:
    mgr = WbBridgeSessionManager()
    sid = str(uuid.uuid4())
    session = WbBridgeSession(session_id=sid, cwd="/tmp", proc=_FakeProc())
    session.append_line(_result_line("旧"))
    with mgr._global_lock:
        mgr._sessions[sid] = session

    assert mgr.drain_visible_stream_text(sid) == ""
    mgr.send_user_message(sid, "hi")
    session.append_line(_assistant_line("OK"))
    assert mgr.drain_visible_stream_text(sid) == "OK"
    assert mgr.drain_visible_stream_text(sid) == ""


def _tool_line_named(tool_id: str, name: str) -> str:
    return json.dumps(
        {
            "type": "assistant",
            "message": {
                "role": "assistant",
                "content": [
                    {
                        "type": "tool_use",
                        "id": tool_id,
                        "name": name,
                        "input": {"query": "should-not-leak"},
                    }
                ],
            },
        },
        ensure_ascii=False,
    )


def test_iter_tool_progress_start_end_and_skips_args() -> None:
    starts = list(iter_raw_tool_progress(_tool_start_stream_event("toolu_1", "WebSearch")))
    assert len(starts) == 1
    assert starts[0].kind == "start"
    assert starts[0].tool_call_id == "toolu_1"
    assert starts[0].name == "WebSearch"

    assistant_starts = list(iter_raw_tool_progress(_tool_line()))
    assert len(assistant_starts) == 1
    assert assistant_starts[0].name == "Bash"
    assert assistant_starts[0].tool_call_id == "t1"

    ends = list(iter_raw_tool_progress(_tool_result_line("t1", is_error=False, content="HUGE " * 200)))
    assert len(ends) == 1
    assert ends[0].kind == "end"
    assert ends[0].tool_call_id == "t1"
    assert ends[0].is_error is False

    err = list(iter_raw_tool_progress(_tool_result_line("t1", is_error=True)))
    assert err[0].is_error is True
    assert list(iter_raw_tool_progress(_delta_line("x"))) == []
    assert list(iter_raw_tool_progress(_result_line("final"))) == []


def test_tool_tracker_dedupes_partial_then_assistant_start() -> None:
    tracker = ToolProgressTracker()
    first = tracker.start("t1", "WebSearch")
    assert first is not None and first.name == "WebSearch"
    assert tracker.start("t1", "WebSearch") is None
    end = tracker.end("t1")
    assert end is not None and end.name == "WebSearch" and end.is_error is False
    assert tracker.end("t1") is None


def test_drain_midturn_orders_tool_then_text() -> None:
    lines = [
        _tool_start_stream_event("t9", "WebSearch"),
        _tool_line_named("t9", "WebSearch"),  # deduped
        _tool_result_line("t9"),
        _delta_line("答"),
        _assistant_line("答案"),
    ]
    text_tracker = VisibleTextTracker()
    tool_tracker = ToolProgressTracker()
    items, idx = drain_midturn_items_from_lines(
        lines,
        start_index=0,
        text_tracker=text_tracker,
        tool_tracker=tool_tracker,
    )
    assert idx == len(lines)
    kinds = [i.kind for i in items]
    assert kinds[:3] == ["tool_start", "tool_end", "text"]
    assert items[0].name == "WebSearch"
    assert items[1].tool_call_id == "t9"
    assert "".join(i.text for i in items if i.kind == "text") == "答案"


def test_cc_drain_emits_tool_progress_items() -> None:
    mgr = BridgeSessionManager()
    sid = str(uuid.uuid4())
    session = BridgeSession(session_id=sid, cwd="/tmp", proc=_FakeProc())
    with mgr._global_lock:
        mgr._sessions[sid] = session

    assert mgr.drain_midturn_stream_items(sid) == []
    mgr.send_user_message(sid, "搜新闻")
    session.append_line(_tool_start_stream_event("call_news", "WebSearch"))
    items = mgr.drain_midturn_stream_items(sid)
    assert items == [
        {"kind": "tool_start", "tool_call_id": "call_news", "name": "WebSearch"}
    ]
    session.append_line(_tool_result_line("call_news", content="lots of news"))
    session.append_line(_assistant_line("今日要闻如下"))
    items2 = mgr.drain_midturn_stream_items(sid)
    assert items2[0]["kind"] == "tool_end"
    assert items2[0]["tool_call_id"] == "call_news"
    assert items2[0]["is_error"] is False
    assert items2[1] == {"kind": "text", "text": "今日要闻如下"}
    assert all("query" not in json.dumps(i, ensure_ascii=False) for i in items2)

