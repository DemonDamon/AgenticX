"""Smoke: CodeBuddy OAuth login job via Tencent auth/state + token APIs."""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

from agenticx.harness.codebuddy_oauth_login import (
    CodebuddyOAuthJobStatus,
    classify_codebuddy_oauth_outcome,
    codebuddy_oauth_job_snapshot,
    get_codebuddy_oauth_job,
    start_codebuddy_oauth_login,
)


def test_classify_oauth_outcome_rules() -> None:
    status, err = classify_codebuddy_oauth_outcome(
        exit_code=0,
        authorize_url=None,
        auth_verified=False,
    )
    assert status == CodebuddyOAuthJobStatus.FAILED
    assert err

    status, err = classify_codebuddy_oauth_outcome(
        exit_code=0,
        authorize_url="https://copilot.tencent.com/login?state=x",
        auth_verified=False,
    )
    assert status == CodebuddyOAuthJobStatus.FAILED
    assert err

    status, err = classify_codebuddy_oauth_outcome(
        exit_code=0,
        authorize_url="https://copilot.tencent.com/login?state=x",
        auth_verified=True,
    )
    assert status == CodebuddyOAuthJobStatus.SUCCESS
    assert err is None

    status, _ = classify_codebuddy_oauth_outcome(
        exit_code=2,
        authorize_url="https://copilot.tencent.com/login?state=x",
        auth_verified=True,
    )
    assert status == CodebuddyOAuthJobStatus.FAILED


@pytest.mark.asyncio
async def test_start_surfaces_authorize_url_and_writes_session(tmp_path: Path) -> None:
    auth_path = tmp_path / "Tencent-Cloud.coding-copilot.info"

    async def fake_state(api_base: str):
        assert api_base
        return "state-1", "https://www.codebuddy.cn/login?platform=cli&state=state-1"

    async def fake_token(api_base, state, *, timeout_seconds, should_cancel=None, poll_interval=1.5):
        assert state == "state-1"
        return {
            "accessToken": "access-token-demo",
            "refreshToken": "refresh-token-demo",
            "tokenType": "Bearer",
            "expiresIn": 3600,
            "refreshExpiresIn": 7200,
            "domain": "www.codebuddy.cn",
        }

    async def fake_account(api_base, access_token):
        assert access_token == "access-token-demo"
        return {"uid": "u1", "nickname": "Demo", "type": "personal"}

    with patch(
        "agenticx.harness.codebuddy_oauth_login.resolve_codebuddy_oauth_api_base",
        return_value="https://www.codebuddy.cn",
    ), patch(
        "agenticx.harness.codebuddy_oauth_login.create_codebuddy_oauth_state",
        new=AsyncMock(side_effect=fake_state),
    ), patch(
        "agenticx.harness.codebuddy_oauth_login.poll_codebuddy_oauth_token",
        new=AsyncMock(side_effect=fake_token),
    ), patch(
        "agenticx.harness.codebuddy_oauth_login.fetch_codebuddy_account",
        new=AsyncMock(side_effect=fake_account),
    ), patch(
        "agenticx.harness.codebuddy_oauth_login.codebuddy_auth_info_path",
        return_value=auth_path,
    ):
        job = await start_codebuddy_oauth_login("/tmp")
        for _ in range(100):
            if job.status in (CodebuddyOAuthJobStatus.SUCCESS, CodebuddyOAuthJobStatus.FAILED):
                break
            await asyncio.sleep(0.02)

    assert job.authorize_url and "codebuddy.cn" in job.authorize_url
    assert job.status == CodebuddyOAuthJobStatus.SUCCESS
    assert job.auth_verified is True
    assert auth_path.is_file()
    saved = json.loads(auth_path.read_text(encoding="utf-8"))
    assert saved["auth"]["accessToken"] == "access-token-demo"
    assert saved["account"]["uid"] == "u1"
    snap = codebuddy_oauth_job_snapshot(job)
    assert snap["status"] == "success"
    assert get_codebuddy_oauth_job(job.job_id) is job


@pytest.mark.asyncio
async def test_state_failure_marks_failed() -> None:
    with patch(
        "agenticx.harness.codebuddy_oauth_login.resolve_codebuddy_oauth_api_base",
        return_value="https://www.codebuddy.cn",
    ), patch(
        "agenticx.harness.codebuddy_oauth_login.create_codebuddy_oauth_state",
        new=AsyncMock(side_effect=RuntimeError("auth/state failed")),
    ):
        job = await start_codebuddy_oauth_login("/tmp")
        for _ in range(80):
            if job.status == CodebuddyOAuthJobStatus.FAILED:
                break
            await asyncio.sleep(0.02)

    assert job.status == CodebuddyOAuthJobStatus.FAILED
    assert job.authorize_url is None
    assert "auth/state" in (job.error or "")


@pytest.mark.asyncio
async def test_timeout_without_token_is_failed() -> None:
    async def fake_state(api_base: str):
        return "state-2", "https://copilot.tencent.com/login?platform=cli&state=state-2"

    async def fake_token(*args, **kwargs):
        raise TimeoutError("等待腾讯授权超时")

    with patch(
        "agenticx.harness.codebuddy_oauth_login.resolve_codebuddy_oauth_api_base",
        return_value="https://copilot.tencent.com",
    ), patch(
        "agenticx.harness.codebuddy_oauth_login.create_codebuddy_oauth_state",
        new=AsyncMock(side_effect=fake_state),
    ), patch(
        "agenticx.harness.codebuddy_oauth_login.poll_codebuddy_oauth_token",
        new=AsyncMock(side_effect=fake_token),
    ):
        job = await start_codebuddy_oauth_login("/tmp")
        for _ in range(80):
            if job.status == CodebuddyOAuthJobStatus.FAILED:
                break
            await asyncio.sleep(0.02)

    assert job.authorize_url
    assert job.status == CodebuddyOAuthJobStatus.FAILED
    assert "超时" in (job.error or "")
