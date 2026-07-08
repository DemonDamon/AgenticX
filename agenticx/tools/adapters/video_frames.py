#!/usr/bin/env python3
"""Video frame extraction adapter backed by ffmpeg/ffprobe.

Author: Damon Li
"""

from __future__ import annotations

import asyncio
import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, List, Optional, Sequence


@dataclass
class VideoProbe:
    """Basic metadata extracted from ffprobe."""

    duration_seconds: float
    width: int
    height: int
    has_audio: bool
    format_name: str = ""
    video_codec: str = ""


@dataclass
class FrameExtractionResult:
    """Representative frame extraction result."""

    frames: List[Path] = field(default_factory=list)
    timestamps: List[float] = field(default_factory=list)
    probe: Optional[VideoProbe] = None
    strategy: str = ""


class VideoFrameExtractor:
    """Extract representative frames from a local video via ffmpeg/ffprobe."""

    SUPPORTED_FORMATS = [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"]

    def __init__(self, timeout: float = 180.0) -> None:
        self.timeout = timeout

    @staticmethod
    def is_available() -> bool:
        """Return True only when BOTH ffmpeg and ffprobe are resolvable on PATH."""
        return bool(shutil.which("ffmpeg")) and bool(shutil.which("ffprobe"))

    @staticmethod
    def _ffprobe_bin() -> Optional[str]:
        """Resolve ffprobe binary path."""
        return shutil.which("ffprobe")

    @staticmethod
    def _ffmpeg_bin() -> Optional[str]:
        """Resolve ffmpeg binary path."""
        return shutil.which("ffmpeg")

    async def _run_subprocess(self, cmd: Sequence[str]) -> tuple[int, bytes, bytes]:
        """Run a subprocess command with timeout protection."""
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=self.timeout)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.communicate()
            raise RuntimeError(f"command timed out after {self.timeout:.1f}s: {' '.join(cmd[:3])}")
        return proc.returncode, stdout, stderr

    @staticmethod
    def _parse_duration(payload: dict[str, Any]) -> float:
        """Parse duration from ffprobe format/streams with safe fallback."""
        format_obj = payload.get("format")
        if isinstance(format_obj, dict):
            try:
                return max(0.0, float(format_obj.get("duration", 0.0) or 0.0))
            except (TypeError, ValueError):
                pass

        streams = payload.get("streams")
        if not isinstance(streams, list):
            return 0.0

        candidates: List[float] = []
        for stream in streams:
            if not isinstance(stream, dict):
                continue
            try:
                raw_duration = stream.get("duration")
                if raw_duration is None:
                    continue
                value = float(raw_duration)
                if value > 0:
                    candidates.append(value)
            except (TypeError, ValueError):
                continue
        return max(candidates) if candidates else 0.0

    async def probe(self, path: Path) -> VideoProbe:
        """Run ffprobe and return normalized metadata."""
        ffprobe_bin = self._ffprobe_bin()
        if not ffprobe_bin:
            raise FileNotFoundError("ffprobe not found")

        cmd = [
            ffprobe_bin,
            "-v",
            "error",
            "-show_format",
            "-show_streams",
            "-print_format",
            "json",
            str(path),
        ]
        code, stdout, stderr = await self._run_subprocess(cmd)
        if code != 0:
            err = stderr.decode("utf-8", errors="ignore").strip() or "ffprobe failed"
            raise RuntimeError(f"ffprobe failed: {err}")

        try:
            payload = json.loads(stdout.decode("utf-8", errors="ignore") or "{}")
        except json.JSONDecodeError as exc:
            raise RuntimeError(f"ffprobe JSON decode failed: {exc}") from exc

        streams = payload.get("streams")
        if not isinstance(streams, list):
            streams = []

        video_stream: dict[str, Any] | None = None
        has_audio = False
        for stream in streams:
            if not isinstance(stream, dict):
                continue
            stream_type = str(stream.get("codec_type", "") or "").lower()
            if stream_type == "video" and video_stream is None:
                video_stream = stream
            elif stream_type == "audio":
                has_audio = True

        width = int((video_stream or {}).get("width") or 0)
        height = int((video_stream or {}).get("height") or 0)
        video_codec = str((video_stream or {}).get("codec_name") or "")
        format_name = str((payload.get("format") or {}).get("format_name") or "")
        duration_seconds = self._parse_duration(payload)
        return VideoProbe(
            duration_seconds=duration_seconds,
            width=width,
            height=height,
            has_audio=has_audio,
            format_name=format_name,
            video_codec=video_codec,
        )

    @staticmethod
    def plan_frame_count(duration: float, *, interval: float, min_frames: int, max_frames: int) -> int:
        """Compute adaptive frame count and clamp to min/max bounds."""
        safe_min = max(1, int(min_frames))
        safe_max = max(safe_min, int(max_frames))
        safe_interval = max(1e-6, float(interval))
        if duration <= 0:
            return safe_min
        planned = int(round(duration / safe_interval))
        return min(safe_max, max(safe_min, planned))

    async def extract_interval(
        self,
        path: Path,
        out_dir: Path,
        *,
        frame_count: int,
        probe: VideoProbe,
    ) -> FrameExtractionResult:
        """Extract evenly sampled frames by fast seeking each target timestamp."""
        ffmpeg_bin = self._ffmpeg_bin()
        if not ffmpeg_bin:
            raise FileNotFoundError("ffmpeg not found")
        out_dir.mkdir(parents=True, exist_ok=True)

        target_count = max(1, int(frame_count))
        duration = max(0.0, float(probe.duration_seconds or 0.0))
        frames: List[Path] = []
        timestamps: List[float] = []
        for i in range(target_count):
            ts = (duration * (i + 0.5) / target_count) if duration > 0 else 0.0
            out_path = out_dir / f"frame_{i + 1:02d}.png"
            cmd = [
                ffmpeg_bin,
                "-y",
                "-ss",
                f"{ts:.3f}",
                "-i",
                str(path),
                "-frames:v",
                "1",
                "-q:v",
                "2",
                "-vf",
                "scale='min(1280,iw)':-2",
                str(out_path),
            ]
            code, _stdout, _stderr = await self._run_subprocess(cmd)
            if code != 0:
                continue
            if not out_path.exists():
                continue
            try:
                if out_path.stat().st_size <= 0:
                    continue
            except OSError:
                continue
            frames.append(out_path)
            timestamps.append(ts)

        if not frames:
            raise RuntimeError("ffmpeg did not produce any frame")
        return FrameExtractionResult(
            frames=frames,
            timestamps=timestamps,
            probe=probe,
            strategy="interval",
        )

    async def extract_scene(
        self,
        path: Path,
        out_dir: Path,
        *,
        max_frames: int,
        probe: VideoProbe,
    ) -> Optional[FrameExtractionResult]:
        """Try scene-change frame extraction and return None when unsuitable."""
        ffmpeg_bin = self._ffmpeg_bin()
        if not ffmpeg_bin:
            raise FileNotFoundError("ffmpeg not found")
        out_dir.mkdir(parents=True, exist_ok=True)
        cap = max(1, int(max_frames))
        pattern = out_dir / "scene_%03d.png"
        cmd = [
            ffmpeg_bin,
            "-y",
            "-i",
            str(path),
            "-vf",
            "select=gt(scene\\,0.3),scale='min(1280,iw)':-2",
            "-vsync",
            "vfr",
            "-frames:v",
            str(cap),
            str(pattern),
        ]
        code, _stdout, _stderr = await self._run_subprocess(cmd)
        if code != 0:
            return None

        frames = sorted(out_dir.glob("scene_*.png"))
        if not frames:
            return None

        duration = max(0.0, float(probe.duration_seconds or 0.0))
        total = len(frames)
        timestamps: List[float] = []
        for idx in range(total):
            ts = (duration * (idx + 0.5) / total) if duration > 0 else 0.0
            timestamps.append(ts)
        return FrameExtractionResult(
            frames=frames,
            timestamps=timestamps,
            probe=probe,
            strategy="scene",
        )
