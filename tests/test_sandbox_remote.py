#!/usr/bin/env python3
"""Tests for RemoteSandbox and is_remote_available.

Author: Damon Li
"""

import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from agenticx.sandbox.audit import SandboxAuditTrail
from agenticx.sandbox.backends.remote import RemoteSandbox, is_remote_available
from agenticx.sandbox.types import ExecutionResult, SandboxStatus


def test_is_remote_available_true(monkeypatch):
    class _Resp:
        status = 200

    class _Ctx:
        def __enter__(self):
            return _Resp()

        def __exit__(self, *args):
            return False

    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: _Ctx())
    assert is_remote_available("http://127.0.0.1:5555") is True


def test_is_remote_available_non_200(monkeypatch):
    class _Resp:
        status = 503

    class _Ctx:
        def __enter__(self):
            return _Resp()

        def __exit__(self, *args):
            return False

    import urllib.request

    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: _Ctx())
    assert is_remote_available("http://127.0.0.1:5555") is False


def test_is_remote_available_on_error(monkeypatch):
    import urllib.error
    import urllib.request

    def _boom(*a, **k):
        raise urllib.error.URLError("down")

    monkeypatch.setattr(urllib.request, "urlopen", _boom)
    assert is_remote_available("http://127.0.0.1:5555") is False


@pytest.mark.asyncio
async def test_remote_execute_with_audit(tmp_path):
    trail = SandboxAuditTrail(log_dir=str(tmp_path))
    sb = RemoteSandbox(
        sandbox_id="sb-audit-remote",
        server_url="http://127.0.0.1:9",
        audit_trail=trail,
    )
    sb._status = SandboxStatus.RUNNING
    fake = ExecutionResult(
        stdout="ok",
        stderr="",
        exit_code=0,
        success=True,
        duration_ms=2.0,
        language="python",
    )
    sb._remote_execute = AsyncMock(return_value=fake)
    result = await sb.execute("print(1)")
    assert result.stdout == "ok"
    files = list(Path(tmp_path).glob("*.jsonl"))
    assert len(files) == 1
    with open(files[0], encoding="utf-8") as f:
        entry = json.loads(f.readline())
    assert entry["sandbox_id"] == "sb-audit-remote"
    assert entry["operation"] == "execute"
