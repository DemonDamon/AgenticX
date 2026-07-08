#!/usr/bin/env python3
"""Tests for video frame extraction adapter.

Author: Damon Li
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from agenticx.tools.adapters.video_frames import VideoFrameExtractor


def test_plan_frame_count_adaptive() -> None:
    """Frame count adapts by duration and clamps to min/max."""
    assert VideoFrameExtractor.plan_frame_count(60, interval=8, min_frames=4, max_frames=12) == 8
    assert VideoFrameExtractor.plan_frame_count(300, interval=8, min_frames=4, max_frames=12) == 12
    assert VideoFrameExtractor.plan_frame_count(5, interval=8, min_frames=4, max_frames=12) == 4
    assert VideoFrameExtractor.plan_frame_count(0, interval=8, min_frames=4, max_frames=12) == 4


def test_is_available_gate(monkeypatch: pytest.MonkeyPatch) -> None:
    """Availability requires both ffmpeg and ffprobe."""

    def _fake_which(name: str) -> str | None:
        if name == "ffmpeg":
            return "/usr/local/bin/ffmpeg"
        if name == "ffprobe":
            return None
        return None

    monkeypatch.setattr("agenticx.tools.adapters.video_frames.shutil.which", _fake_which)
    assert VideoFrameExtractor.is_available() is False


@pytest.mark.asyncio
@pytest.mark.skipif(not VideoFrameExtractor.is_available(), reason="ffmpeg/ffprobe not available")
async def test_probe_parses_json(tmp_path: Path) -> None:
    """Probe should parse basic metadata from an ffmpeg-generated sample video."""
    mp4_path = tmp_path / "sample.mp4"
    subprocess.run(
        [
            "ffmpeg",
            "-f",
            "lavfi",
            "-i",
            "testsrc=duration=1:size=320x240:rate=10",
            "-y",
            str(mp4_path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    extractor = VideoFrameExtractor()
    probe = await extractor.probe(mp4_path)
    assert probe.duration_seconds > 0
    assert probe.width == 320
    assert probe.height == 240
