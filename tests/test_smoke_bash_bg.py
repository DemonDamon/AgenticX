#!/usr/bin/env python3
"""Smoke tests for background bash tools (bash_bg_*).

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import re
import shlex
import sys
import time
from unittest.mock import MagicMock

import pytest

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession
from agenticx.runtime.prompts.meta_agent import build_meta_agent_system_prompt


def _python_cmd(code: str) -> str:
    """Build a shell-safe python command string."""
    return f"{shlex.quote(sys.executable)} -u -c {shlex.quote(code)}"


def _extract_job_id(text: str) -> str:
    """Extract job_id from bash_bg_start output."""
    match = re.search(r"^job_id=(\w+)$", text, re.MULTILINE)
    assert match is not None, text
    return match.group(1)


@pytest.fixture(autouse=True)
def auto_confirm(monkeypatch: pytest.MonkeyPatch) -> None:
    """Auto-approve confirm gate to keep tests deterministic."""

    async def _yes(*_a: object, **_k: object) -> bool:
        return True

    monkeypatch.setattr(agent_tools, "_confirm", _yes)


async def _reap_bg_jobs() -> None:
    """Kill leftover processes and **await** their drain tasks.

    只 kill 进程是不够的：``drain_task`` 抓着子进程的 transport，不取消并等它结束，
    任务就会活过事件循环的关闭，之后 ``BaseSubprocessTransport.__del__`` 往死循环里
    投 callback，抛出无法捕获的 "Event loop is closed" —— 并被算在当时碰巧在跑的
    那个用例头上。
    """
    jobs = list(agent_tools._BASH_BG_JOBS.values())
    agent_tools._BASH_BG_JOBS.clear()
    for job in jobs:
        try:
            if job.proc.returncode is None:
                job.proc.kill()
        except Exception:
            pass
    pending = [
        job.drain_task
        for job in jobs
        if getattr(job, "drain_task", None) is not None and not job.drain_task.done()
    ]
    # 先给 drain 自己收尾的机会，别上来就 cancel：进程被 kill 之后 stream 会 EOF、
    # `await job.proc.wait()` 会返回，drain 正常结束，子进程 transport 才会被关掉。
    # 直接 cancel 会让 proc.wait() 永远等不到，transport 就留到循环关闭之后才析构。
    if pending:
        _, still_pending = await asyncio.wait(pending, timeout=2.0)
        for task in still_pending:
            task.cancel()
        if still_pending:
            await asyncio.gather(*still_pending, return_exceptions=True)
    # 兜底：即使没有 drain_task，也要把 transport 收干净。
    for job in jobs:
        try:
            await asyncio.wait_for(job.proc.wait(), timeout=1.0)
        except Exception:
            pass


@pytest.fixture(autouse=True)
async def clean_bg_jobs():
    """Ensure no leaked background process or drain task between tests.

    收尾必须有：原来只在**用例开始前**清理，最后一个用例起的 job 从来没人管，
    它的 drain_task 就这么活到了循环关闭之后。
    """
    await _reap_bg_jobs()
    yield
    await _reap_bg_jobs()


async def _poll_until_contains(
    session: StudioSession,
    job_id: str,
    needle: str,
    timeout_sec: float = 5.0,
) -> str:
    """Poll job output until a text appears or timeout."""
    deadline = time.monotonic() + timeout_sec
    last = ""
    while time.monotonic() < deadline:
        last = await agent_tools._tool_bash_bg_poll({"job_id": job_id}, session)
        if needle in last:
            return last
        await asyncio.sleep(0.1)
    return last


@pytest.mark.asyncio
async def test_bg_short_command_exits() -> None:
    session = StudioSession()
    cmd = _python_cmd("print('hello-bg', flush=True)")
    out = await agent_tools._tool_bash_bg_start(
        {"command": cmd, "first_wait_sec": 2},
        session,
        confirm_gate=MagicMock(),
        emit_event=None,
    )
    assert "status=exited" in out
    assert "exit_code=0" in out
    assert "hello-bg" in out


@pytest.mark.asyncio
async def test_bg_long_command_stays_running_and_extracts_url() -> None:
    session = StudioSession()
    cmd = _python_cmd("import time; print('https://open.feishu.cn/x', flush=True); time.sleep(3)")
    out = await agent_tools._tool_bash_bg_start(
        {"command": cmd, "first_wait_sec": 1},
        session,
        confirm_gate=MagicMock(),
        emit_event=None,
    )
    assert "status=running" in out
    assert "auth_urls:" in out
    assert "https://open.feishu.cn/x" in out
    job_id = _extract_job_id(out)
    stop = await agent_tools._tool_bash_bg_stop({"job_id": job_id, "force": True}, session)
    assert "OK: stopped" in stop or "OK: job already exited" in stop


@pytest.mark.asyncio
async def test_bg_poll_incremental() -> None:
    session = StudioSession()
    cmd = _python_cmd(
        "import time; print('line-a', flush=True); time.sleep(0.6); print('line-b', flush=True); time.sleep(1.0)"
    )
    started = await agent_tools._tool_bash_bg_start(
        {"command": cmd, "first_wait_sec": 1},
        session,
        confirm_gate=MagicMock(),
        emit_event=None,
    )
    job_id = _extract_job_id(started)
    first = await agent_tools._tool_bash_bg_poll({"job_id": job_id}, session)
    second = await _poll_until_contains(session, job_id, "line-b", timeout_sec=4.0)
    assert "line-b" in second
    assert "line-b" not in first


@pytest.mark.asyncio
async def test_bg_input_stdin() -> None:
    session = StudioSession()
    cmd = _python_cmd(
        "import sys; print('ready', flush=True); "
        "line=input(); print('got ' + line, flush=True); sys.stdout.flush();"
    )
    started = await agent_tools._tool_bash_bg_start(
        {"command": cmd, "first_wait_sec": 1},
        session,
        confirm_gate=MagicMock(),
        emit_event=None,
    )
    job_id = _extract_job_id(started)
    write_out = await agent_tools._tool_bash_bg_input({"job_id": job_id, "text": "hi"}, session)
    assert "OK: wrote" in write_out
    polled = await _poll_until_contains(session, job_id, "got hi", timeout_sec=4.0)
    assert "got hi" in polled


@pytest.mark.asyncio
async def test_bg_stop() -> None:
    session = StudioSession()
    cmd = _python_cmd("import time; print('alive', flush=True); time.sleep(10)")
    started = await agent_tools._tool_bash_bg_start(
        {"command": cmd, "first_wait_sec": 1},
        session,
        confirm_gate=MagicMock(),
        emit_event=None,
    )
    job_id = _extract_job_id(started)
    stop = await agent_tools._tool_bash_bg_stop({"job_id": job_id}, session)
    assert "OK: stopped" in stop
    polled = await agent_tools._tool_bash_bg_poll({"job_id": job_id}, session)
    assert "status=exited" in polled


@pytest.mark.asyncio
async def test_bg_ownership() -> None:
    session_a = StudioSession()
    session_b = StudioSession()
    # Real production sessions carry the id as `_session_id` (see
    # studio/server.py `setattr(session, "_session_id", ...)`), not
    # `session_id` — assert against the real attribute to catch ownership
    # isolation regressions.
    setattr(session_a, "_session_id", "session-a")
    setattr(session_b, "_session_id", "session-b")
    cmd = _python_cmd("import time; print('owned', flush=True); time.sleep(2)")
    started = await agent_tools._tool_bash_bg_start(
        {"command": cmd, "first_wait_sec": 1},
        session_a,
        confirm_gate=MagicMock(),
        emit_event=None,
    )
    job_id = _extract_job_id(started)
    denied = await agent_tools._tool_bash_bg_poll({"job_id": job_id}, session_b)
    assert "ERROR: unknown or not-owned job_id" in denied


@pytest.mark.asyncio
async def test_bg_reuses_safety_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    async def _deny(*_a: object, **_k: object) -> bool:
        return False

    monkeypatch.setattr(agent_tools, "_confirm", _deny)
    session = StudioSession()
    out = await agent_tools._tool_bash_bg_start(
        {"command": "foobar --version"},
        session,
        confirm_gate=MagicMock(),
        emit_event=None,
    )
    assert "CANCELLED: 非白名单命令未执行" in out


def test_bg_session_id_reads_underscore_prefixed_attribute() -> None:
    """Guards against regressing to the wrong `session_id` attribute name.

    Real StudioSession instances only ever get `_session_id` set (see
    studio/server.py); if this helper reads `session_id` instead, every real
    session collapses into the same "default" bucket and job ownership
    isolation silently breaks in production while unit tests (which may set
    either attribute) keep passing.
    """
    session = StudioSession()
    setattr(session, "_session_id", "real-session-123")
    assert agent_tools._bash_bg_session_id(session) == "real-session-123"

    bare_session = StudioSession()
    assert agent_tools._bash_bg_session_id(bare_session) == "default"


def test_prompt_contains_interactive_rule() -> None:
    session = StudioSession()
    prompt = build_meta_agent_system_prompt(session)
    assert "bash_bg_start" in prompt
    assert "auth_urls" in prompt
    assert "禁止高频轮询" in prompt
