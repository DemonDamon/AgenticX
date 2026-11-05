#!/usr/bin/env python3
"""CC bridge wait_for_success_result must ignore prior-turn success lines.

Author: Damon Li
"""

from __future__ import annotations

import threading
import time
import uuid
from types import SimpleNamespace

from agenticx.cc_bridge.session_manager import BridgeSession, BridgeSessionManager
from agenticx.harness.adapters.claude_code import ClaudeCodeAdapter, _last_result_text
from agenticx.harness.types import TURN_STATUS_SUCCESS, TurnRequest


class _FakeProc:
    def __init__(self, *, running: bool = True) -> None:
        self.stdin = SimpleNamespace(write=lambda *_a, **_k: None, flush=lambda: None)
        self._code = None if running else 0

    def poll(self):
        return self._code

    def wait(self, timeout=None):
        self._code = 0
        return 0

    def terminate(self) -> None:
        self._code = 0

    def kill(self) -> None:
        self._code = 0


_RESULT_1 = (
    '{"type":"result","subtype":"success","result":"你好！我是 Claude Code。"}'
)
_RESULT_2 = (
    '{"type":"result","subtype":"success",'
    '"result":"人生是一场持续的探索与选择。"}'
)


def test_wait_ignores_prior_turn_success_until_new_result() -> None:
    mgr = BridgeSessionManager()
    sid = str(uuid.uuid4())
    session = BridgeSession(session_id=sid, cwd="/tmp", proc=_FakeProc(running=True))
    session.append_line('{"type":"assistant","message":{"content":"hi"}}')
    session.append_line(_RESULT_1)
    with mgr._global_lock:
        mgr._sessions[sid] = session

    # Simulate follow-up send watermark (as send_user_message does).
    with session.lock:
        session._result_wait_watermark = len(session.lines)

    # Without a new result, wait must time out (not succeed on RESULT_1).
    ok_early, _ = mgr.wait_for_success_result(sid, 0.35, poll_interval=0.05)
    assert ok_early is False

    def _late_result() -> None:
        time.sleep(0.12)
        session.append_line(_RESULT_2)

    threading.Thread(target=_late_result, daemon=True).start()
    ok, tail = mgr.wait_for_success_result(sid, 2.0, poll_interval=0.05)
    assert ok is True
    assert _RESULT_2 in tail
    assert _last_result_text(session) == "人生是一场持续的探索与选择。"


def test_send_user_message_sets_watermark_before_wait() -> None:
    mgr = BridgeSessionManager()
    sid = str(uuid.uuid4())
    session = BridgeSession(session_id=sid, cwd="/tmp", proc=_FakeProc(running=True))
    session.append_line(_RESULT_1)
    with mgr._global_lock:
        mgr._sessions[sid] = session

    mgr.send_user_message(sid, "思考下，人生")
    assert session._result_wait_watermark == 1  # only RESULT_1 was present

    ok, _ = mgr.wait_for_success_result(sid, 0.3, poll_interval=0.05)
    assert ok is False

    session.append_line(_RESULT_2)
    ok2, _ = mgr.wait_for_success_result(sid, 1.0, poll_interval=0.05)
    assert ok2 is True
    assert "人生是一场" in _last_result_text(session)


def test_adapter_turn_followup_picks_second_result_text() -> None:
    adapter = ClaudeCodeAdapter()
    sid = str(uuid.uuid4())
    session = BridgeSession(session_id=sid, cwd="/tmp", proc=_FakeProc(running=True))
    session.append_line(_RESULT_1)
    with adapter._global_lock:
        adapter._sessions[sid] = session

    def _emit_second() -> None:
        # After send_user_message watermarks, append the new result.
        time.sleep(0.08)
        session.append_line(_RESULT_2)

    threading.Thread(target=_emit_second, daemon=True).start()
    result = adapter.turn(sid, TurnRequest(text="思考下，人生", wait_seconds=2.0))
    assert result.status == TURN_STATUS_SUCCESS
    assert "人生是一场" in result.result_text
    assert "你好" not in result.result_text
