#!/usr/bin/env python3
"""Tests for video_understand tool.

Author: Damon Li
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from agenticx.cli import agent_tools
from agenticx.cli.studio import StudioSession
from agenticx.tools.adapters.video_frames import VideoFrameExtractor


def _vision_session() -> StudioSession:
    session = StudioSession()
    session.provider_name = "openai"
    session.model_name = "gpt-4o"
    return session


@pytest.mark.asyncio
async def test_missing_path() -> None:
    session = _vision_session()
    result = await agent_tools._tool_video_understand({}, session)
    assert result.startswith("ERROR: missing required parameter 'path'.")


@pytest.mark.asyncio
async def test_non_vision_model_blocked(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    video_path = tmp_path / "sample.mp4"
    video_path.write_bytes(b"not-a-real-video")
    session = StudioSession()
    session.provider_name = "minimax"
    session.model_name = "MiniMax-M2"
    monkeypatch.setattr(agent_tools, "_desktop_unrestricted_fs_enabled", lambda: True)
    result = await agent_tools._tool_video_understand({"path": str(video_path)}, session)
    assert "does not support vision" in result


@pytest.mark.asyncio
async def test_ffmpeg_missing_hint(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    video_path = tmp_path / "sample.mp4"
    video_path.write_bytes(b"placeholder")
    session = _vision_session()
    monkeypatch.setattr(agent_tools, "_desktop_unrestricted_fs_enabled", lambda: True)
    monkeypatch.setattr(VideoFrameExtractor, "is_available", staticmethod(lambda: False))
    result = await agent_tools._tool_video_understand({"path": str(video_path)}, session)
    assert "brew install ffmpeg" in result


@pytest.mark.asyncio
@pytest.mark.skipif(not VideoFrameExtractor.is_available(), reason="ffmpeg/ffprobe not available")
async def test_frames_staged_into_pending(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    video_path = tmp_path / "sample.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=2:size=320x240:rate=10",
            "-y",
            str(video_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    session = _vision_session()
    monkeypatch.setattr(agent_tools, "_desktop_unrestricted_fs_enabled", lambda: True)
    result = await agent_tools._tool_video_understand(
        {"path": str(video_path), "max_frames": 3},
        session,
    )
    assert "frames_attached=" in result
    pending = session.scratchpad.get(agent_tools.PENDING_VISUAL_ATTACHMENTS_KEY, [])
    assert pending
    assert all(str(item.get("data_url", "")).startswith("data:image/png;base64,") for item in pending)
