#!/usr/bin/env python3
"""Unit tests for mid-turn stream-json visible-text extraction.

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
    VisibleTextTracker,
    drain_visible_text_from_lines,
    iter_raw_text_fragments,
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
