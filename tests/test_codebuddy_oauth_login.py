"""Smoke: CodeBuddy OAuth login job (subprocess, no harness REPL)."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from agenticx.harness.codebuddy_oauth_login import (
    CodebuddyOAuthJobStatus,
    codebuddy_oauth_job_snapshot,
    get_codebuddy_oauth_job,
    start_codebuddy_oauth_login,
)


@pytest.mark.asyncio
async def test_start_fails_when_executable_missing() -> None:
    with patch(
        "agenticx.wb_bridge.settings.resolve_codebuddy_executable",
        side_effect=RuntimeError("no cli"),
    ):
        job = await start_codebuddy_oauth_login("/tmp")
    assert job.status == CodebuddyOAuthJobStatus.FAILED
    assert "no cli" in (job.error or "")
    snap = codebuddy_oauth_job_snapshot(job)
    assert snap["status"] == "failed"
    assert get_codebuddy_oauth_job(job.job_id) is job


@pytest.mark.asyncio
async def test_parses_authorize_url_and_success_exit() -> None:
    lines = [
        b"Opening browser for Tencent login...\n",
        b"Visit https://copilot.tencent.com/oauth/authorize?state=abc\n",
        b"Login successful\n",
    ]

    stdout = MagicMock()
    stdout.readline = AsyncMock(side_effect=[*lines, b""])

    fake_proc = MagicMock()
    fake_proc.stdout = stdout
    fake_proc.wait = AsyncMock(return_value=0)

    with patch(
        "agenticx.wb_bridge.settings.resolve_codebuddy_executable",
        return_value="/usr/bin/codebuddy",
    ), patch("asyncio.create_subprocess_exec", AsyncMock(return_value=fake_proc)):
        job = await start_codebuddy_oauth_login("/tmp")
        for _ in range(80):
            if job.status in (CodebuddyOAuthJobStatus.SUCCESS, CodebuddyOAuthJobStatus.FAILED):
                break
            await asyncio.sleep(0.02)

    assert job.authorize_url is not None
    assert "tencent" in job.authorize_url.lower()
    assert job.status == CodebuddyOAuthJobStatus.SUCCESS
    snap = codebuddy_oauth_job_snapshot(job)
    assert snap["authorize_url"]
    assert snap["status"] == "success"


@pytest.mark.asyncio
async def test_failed_exit_sets_error() -> None:
    stdout = MagicMock()
    stdout.readline = AsyncMock(return_value=b"")

    fake_proc = MagicMock()
    fake_proc.stdout = stdout
    fake_proc.wait = AsyncMock(return_value=1)

    with patch(
        "agenticx.wb_bridge.settings.resolve_codebuddy_executable",
        return_value="/usr/bin/codebuddy",
    ), patch("asyncio.create_subprocess_exec", AsyncMock(return_value=fake_proc)):
        job = await start_codebuddy_oauth_login("/tmp")
        for _ in range(80):
            if job.status == CodebuddyOAuthJobStatus.FAILED:
                break
            await asyncio.sleep(0.02)

    assert job.status == CodebuddyOAuthJobStatus.FAILED
    assert job.error
