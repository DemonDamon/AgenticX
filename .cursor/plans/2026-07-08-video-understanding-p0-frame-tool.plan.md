# P0：视频帧提取适配器 + video_understand 工具（纯视觉自适应抽帧）

Planned-with: claude-opus-4.8
Suggested-Impl-Model: gpt-5.3-codex

> 本子规划独立可交付：完成后 Near 即具备稳定、原子化、自适应抽帧的视频视觉理解能力，效果超越 WorkBuddy 的临时 `bash+ffmpeg` 拼凑。**不依赖 P1/P2。**
>
> 实施者无需阅读本次对话，仅凭本文件即可落地。所有落点均给出文件路径 + 函数/锚点 + before/after 意图。

---

## 根因/依据（为何这样做）

- WorkBuddy 固定 `fps=1/3 -frames:v 5` 抽帧，长视频欠采样、过程需 3-4 轮 shell。本方案用一次工具调用完成 ffprobe 探测 + 按时长自适应帧数 + ffmpeg 抽帧。
- 帧如何"被模型看到"：复用既有链路——把每帧作为 `{"name","data_url","mime_type","size","source","note"}` 追加到 `session.scratchpad[PENDING_VISUAL_ATTACHMENTS_KEY]`（键与结构见 `agent_tools.py:4505` `PENDING_VISUAL_ATTACHMENTS_KEY` 与 `_tool_view_image` 的 `pending.append({...})`，`agent_tools.py:4760`）。runtime 的 `_inject_pending_visual_attachments`（`agenticx/runtime/agent_runtime.py:804`）会在下一轮把它们注入为 `image_url` 多模态块。该注入函数**不限制帧数**，只有 `_tool_view_image` 内部有 `_VIEW_IMAGE_MAX_PENDING=4` 上限；视频工具**不走 view_image**，直接 push，帧数由本工具自己的配置上限约束。
- data_url 生成复用 `_data_url_from_bytes(data, mime)`（`agent_tools.py:4561`）；MIME 用 `image/png`（我们固定抽 PNG）。
- 路径解析复用 `_resolve_workspace_path(raw_path, session, pick_existing=True)`（liteparse 里的用法，`agent_tools.py:6004`）。
- 视觉能力兜底复用 `_session_vision_capable(session)`（`agent_tools.py:4620`）。

---

## 变更点 1：新增帧提取适配器

**新建文件**：`agenticx/tools/adapters/video_frames.py`

镜像 `LiteParseAdapter` 的结构（子进程 + `is_available()` + `asyncio.wait_for` 超时）。文件头须含 `Author: Damon Li`，注释/文档字符串全英文（`google-python-style.mdc`）。

接口与语义：

```python
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
from typing import Any, Dict, List, Optional


@dataclass
class VideoProbe:
    duration_seconds: float
    width: int
    height: int
    has_audio: bool
    format_name: str = ""
    video_codec: str = ""


@dataclass
class FrameExtractionResult:
    frames: List[Path] = field(default_factory=list)   # extracted PNG paths, in time order
    timestamps: List[float] = field(default_factory=list)  # seconds for each frame
    probe: Optional[VideoProbe] = None
    strategy: str = ""  # "interval" | "scene"


class VideoFrameExtractor:
    """Extract representative frames from a local video via ffmpeg/ffprobe."""

    SUPPORTED_FORMATS = [".mp4", ".mov", ".m4v", ".mkv", ".webm", ".avi"]

    def __init__(self, timeout: float = 180.0) -> None:
        self.timeout = timeout

    @staticmethod
    def is_available() -> bool:
        """True only when BOTH ffmpeg and ffprobe are resolvable on PATH."""
        return bool(shutil.which("ffmpeg")) and bool(shutil.which("ffprobe"))

    @staticmethod
    def _ffprobe_bin() -> Optional[str]:
        return shutil.which("ffprobe")

    @staticmethod
    def _ffmpeg_bin() -> Optional[str]:
        return shutil.which("ffmpeg")

    async def probe(self, path: Path) -> VideoProbe:
        """Run ffprobe -show_format -show_streams -print_format json."""
        # cmd: [ffprobe, -v, error, -show_format, -show_streams, -print_format, json, str(path)]
        # parse: format.duration, first video stream width/height/codec_name,
        #        has_audio = any stream codec_type == "audio", format.format_name
        ...

    @staticmethod
    def plan_frame_count(duration: float, *, interval: float, min_frames: int, max_frames: int) -> int:
        """Adaptive frame count = clamp(round(duration / interval), min_frames, max_frames).

        Guards: duration<=0 -> min_frames.
        """
        ...

    async def extract_interval(
        self, path: Path, out_dir: Path, *, frame_count: int, probe: VideoProbe
    ) -> FrameExtractionResult:
        """Evenly sample `frame_count` frames across the whole duration.

        For each i in range(frame_count): ts = duration * (i + 0.5) / frame_count
        Run: ffmpeg -y -ss <ts> -i <path> -frames:v 1 -q:v 2 -vf scale='min(1280,iw)':-2 out_dir/frame_XX.png
        (-ss BEFORE -i for fast seek; scale caps long side to keep data_url small.)
        Collect only frames that were actually written; skip missing without failing the batch.
        """
        ...

    async def extract_scene(
        self, path: Path, out_dir: Path, *, max_frames: int, probe: VideoProbe
    ) -> Optional[FrameExtractionResult]:
        """Scene-change keyframes via -vf select='gt(scene,<thr>)'. Optional; may return None
        or fewer frames. Caller falls back to interval when this yields < 2 frames."""
        ...
```

关键实现约束（写进代码，实施者照做）：
- `probe()`：用 `asyncio.create_subprocess_exec(*cmd, stdout=PIPE, stderr=PIPE)` + `await asyncio.wait_for(proc.communicate(), timeout=self.timeout)`；`returncode!=0` 抛 `RuntimeError` 含 stderr 摘要；`duration` 从 `format.duration` 取，缺失时回落遍历 streams 的 `duration`，仍缺失则 `0.0`。
- `extract_interval()`：`-ss <ts>` 必须放在 `-i` **之前**（fast seek，避免每帧解码整段）；输出固定 PNG（`frame_%02d` 或逐帧命名）；`-vf scale='min(1280,iw)':-2` 限制长边到 1280 以控制 base64 体积（单帧 <~1.5MB）。
- 每帧单独一次 ffmpeg 调用（-ss 精确 seek），失败的单帧只跳过、不让整批失败；最终 `frames` 至少 1 帧，否则抛错。
- 不做磁盘清理（临时目录由工具层用 `tempfile.mkdtemp` 创建并在返回后择机清理；见变更点 2）。

---

## 变更点 2：注册 video_understand 工具

文件：`agenticx/cli/agent_tools.py`

### 2.1 并发白名单（只增一行，禁止整段替换）

**锚点**：`_CONCURRENCY_SAFE_STUDIO_TOOLS = frozenset({ ... "liteparse", ... })`（`agent_tools.py:120-146`）。

在集合中 `"liteparse",` 一行**后面**新增一行 `"video_understand",`（该工具只读、无副作用，可并发）。仅精确插入这一行。

### 2.2 工具常量（新增，不改 view_image 常量）

**锚点**：`_VIEW_IMAGE_MAX_PENDING = 4`（`agent_tools.py:4513`）。在其**下方**新增视频专用常量（不要修改 `_VIEW_IMAGE_MAX_PENDING`）：

```python
_VIDEO_UNDERSTAND_DEFAULT_MAX_FRAMES = 12
_VIDEO_UNDERSTAND_HARD_MAX_FRAMES = 24
_VIDEO_UNDERSTAND_DEFAULT_INTERVAL_SECONDS = 8.0
_VIDEO_UNDERSTAND_MIN_FRAMES = 4
_VIDEO_UNDERSTAND_MAX_VIDEO_BYTES = 512 * 1024 * 1024  # reject absurdly large inputs
```

### 2.3 schema 注册

**锚点**：`liteparse` 的 schema 块，结束于 `agent_tools.py:1122`（`},` 收尾，紧接 `list_data_sources` 块 `agent_tools.py:1123`）。在 liteparse 块与 list_data_sources 块**之间**插入新块（精确插入，不动相邻块）：

```python
    {
        "type": "function",
        "function": {
            "name": "video_understand",
            "description": (
                "Understand a local video file (mp4/mov/mkv/webm/avi). Probes metadata "
                "(duration, resolution, audio track) and extracts representative frames "
                "adaptively based on duration, then attaches them for the vision model to "
                "view in the next turn. Prefer this over calling ffmpeg via bash_exec: it is "
                "one atomic call with adaptive sampling. Requires a vision-capable model. "
                "Optionally pass `question` to bias sampling toward what the user asks."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Absolute or workspace-relative path to the video file.",
                    },
                    "question": {
                        "type": "string",
                        "description": "Optional: what the user wants to know about the video.",
                    },
                    "max_frames": {
                        "type": "integer",
                        "description": "Optional cap on extracted frames (clamped to server hard max).",
                    },
                },
                "required": ["path"],
                "additionalProperties": False,
            },
        },
    },
```

> `required: ["path"]` 会被 `_TOOL_REQUIRED_PARAMS`（`agent_tools.py:6119` 循环）自动收录，无需手改该字典。

### 2.4 config 读取辅助（新增函数）

**锚点**：`_tool_liteparse`（`agent_tools.py:5998`）之前或之后新增。用 `ConfigManager.get_value(...)`（已见于 `agent_tools.py:105`）读取 `~/.agenticx/config.yaml` 的 `video_understanding` 节，缺省回落到 2.2 常量：

```python
def _video_understand_settings() -> Dict[str, Any]:
    """Read video_understanding.* from config with safe fallbacks."""
    def _int(key: str, default: int) -> int:
        raw = ConfigManager.get_value(f"video_understanding.{key}")
        try:
            return int(raw) if raw is not None else default
        except (TypeError, ValueError):
            return default
    def _float(key: str, default: float) -> float:
        raw = ConfigManager.get_value(f"video_understanding.{key}")
        try:
            return float(raw) if raw is not None else default
        except (TypeError, ValueError):
            return default
    def _bool(key: str, default: bool) -> bool:
        raw = ConfigManager.get_value(f"video_understanding.{key}")
        if isinstance(raw, bool):
            return raw
        if isinstance(raw, str):
            return raw.strip().lower() in {"1", "true", "yes", "on"}
        return default
    max_frames = min(
        _int("max_frames", _VIDEO_UNDERSTAND_DEFAULT_MAX_FRAMES),
        _VIDEO_UNDERSTAND_HARD_MAX_FRAMES,
    )
    return {
        "max_frames": max(1, max_frames),
        "interval_seconds": max(1.0, _float("interval_seconds", _VIDEO_UNDERSTAND_DEFAULT_INTERVAL_SECONDS)),
        "min_frames": max(1, _int("min_frames", _VIDEO_UNDERSTAND_MIN_FRAMES)),
        "use_scene_detection": _bool("use_scene_detection", False),
    }
```

### 2.5 工具实现（新增函数）

**锚点**：紧接 `_tool_liteparse`（`agent_tools.py:5998-6028`）之后新增 `_tool_video_understand`。语义：

```python
async def _tool_video_understand(
    arguments: Dict[str, Any], session: Optional[StudioSession] = None
) -> str:
    """Probe + adaptively extract frames from a local video and stage them for vision."""
    raw_path = str(arguments.get("path", "")).strip()
    if not raw_path:
        return "ERROR: missing required parameter 'path'."

    # 1) Vision gate FIRST (frames are useless to a text-only model).
    if not _session_vision_capable(session):
        model = str(getattr(session, "model_name", "") or "unknown")
        return (
            f"ERROR: current model '{model}' does not support vision; "
            "switch to a vision-capable model before understanding a video."
        )

    # 2) Resolve + validate path (reuse liteparse's resolver).
    try:
        path = _resolve_workspace_path(raw_path, session, pick_existing=True)
    except ValueError as exc:
        return f"ERROR: {exc}"
    if not path.exists() or not path.is_file():
        return f"ERROR: video not found: {path}"
    ext = path.suffix.lower()
    from agenticx.tools.adapters.video_frames import VideoFrameExtractor
    if ext not in VideoFrameExtractor.SUPPORTED_FORMATS:
        return (
            f"ERROR: unsupported video format '{ext}'. "
            f"Supported: {', '.join(VideoFrameExtractor.SUPPORTED_FORMATS)}"
        )
    try:
        size = path.stat().st_size
    except OSError as exc:
        return f"ERROR: cannot stat video: {exc}"
    if size > _VIDEO_UNDERSTAND_MAX_VIDEO_BYTES:
        return f"ERROR: video too large ({size // (1024*1024)} MB); limit is 512 MB."

    # 3) ffmpeg/ffprobe availability -> explicit install hint (no bare Errno 2).
    if not VideoFrameExtractor.is_available():
        return (
            "ERROR: ffmpeg/ffprobe not found. Install with: brew install ffmpeg "
            "(macOS) or your platform package manager."
        )

    settings = _video_understand_settings()
    req_max = arguments.get("max_frames")
    if req_max is not None:
        try:
            settings["max_frames"] = max(1, min(int(req_max), _VIDEO_UNDERSTAND_HARD_MAX_FRAMES))
        except (TypeError, ValueError):
            pass

    extractor = VideoFrameExtractor()
    tmp_dir = Path(tempfile.mkdtemp(prefix="agenticx_video_"))
    try:
        probe = await extractor.probe(path)
        frame_count = extractor.plan_frame_count(
            probe.duration_seconds,
            interval=settings["interval_seconds"],
            min_frames=settings["min_frames"],
            max_frames=settings["max_frames"],
        )
        result = None
        if settings["use_scene_detection"]:
            result = await extractor.extract_scene(
                path, tmp_dir, max_frames=settings["max_frames"], probe=probe
            )
        if result is None or len(result.frames) < 2:
            result = await extractor.extract_interval(
                path, tmp_dir, frame_count=frame_count, probe=probe
            )
        if not result.frames:
            return "ERROR: failed to extract any frame from the video."

        # 4) Stage frames into the SAME pending-visual channel view_image uses.
        pending = _pending_visual_attachments(session)
        staged = 0
        for idx, frame_path in enumerate(result.frames):
            try:
                data = frame_path.read_bytes()
            except OSError:
                continue
            ts = result.timestamps[idx] if idx < len(result.timestamps) else 0.0
            data_url = _data_url_from_bytes(data, "image/png")
            pending.append(
                {
                    "name": f"{path.stem}_frame_{idx + 1:02d}_t{ts:.1f}s.png",
                    "data_url": data_url,
                    "mime_type": "image/png",
                    "size": len(data),
                    "source": str(path),
                    "note": f"video frame @ {ts:.1f}s",
                }
            )
            staged += 1
        if staged == 0:
            return "ERROR: extracted frames could not be read for attachment."
    except Exception as exc:  # surface full context, not a single-token error
        import traceback
        return (
            f"ERROR: video_understand failed for {path.name}: {exc}\n"
            f"{traceback.format_exc(limit=3)}"
        )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)

    # 5) Return a text summary (frames go via the visual channel next turn).
    audio_note = "with audio track" if probe.has_audio else "no audio track"
    lines = [
        f"[video_understand] {path.name}",
        f"duration={probe.duration_seconds:.1f}s resolution={probe.width}x{probe.height} "
        f"{audio_note} strategy={result.strategy} frames_attached={staged}",
        "Frames are attached as images in the NEXT turn; describe/answer using them.",
    ]
    if probe.has_audio:
        lines.append(
            "NOTE: this video has an audio track that is NOT transcribed in this build; "
            "rely on frames, and if speech content is essential tell the user so."
        )
    return "\n".join(lines)
```

> 依赖的模块级 import（`tempfile`、`shutil`、`Path`）在 `agent_tools.py` 顶部已存在（liteparse/其它工具已用）；若缺失，按 `no-inline-imports` 规则补到文件顶部 import 区（**精确增行，勿整段替换**）。

### 2.6 dispatch 分支（新增一处，精确插入）

**锚点**：`dispatch_tool_async` 里的 liteparse 分支（`agent_tools.py:6498-6499`）：

```python
        if name == "liteparse":
            return await _tool_liteparse(arguments, session)
```

在其后**新增**：

```python
        if name == "video_understand":
            return await _tool_video_understand(arguments, session)
```

---

## 变更点 3：config 文档（可选但推荐）

在 `~/.agenticx/config.yaml`（用户机）无需预置；仅在项目文档或默认配置模板里说明新节（若仓库有 `config.example.yaml` 之类则补，否则跳过，不新建文件）：

```yaml
video_understanding:
  max_frames: 12            # hard cap 24
  interval_seconds: 8       # 1 frame per ~8s, then clamped by min/max
  min_frames: 4
  use_scene_detection: false
```

> 若仓库无现成配置示例文件，**不要**为此新建文件（`no-scope-creep`）；常量默认值已能工作。

---

## 冒烟测试（必须落地并跑绿）

**新建**：`tests/test_video_frames_adapter.py`
- `test_plan_frame_count_adaptive`：`plan_frame_count(60, interval=8, min_frames=4, max_frames=12) == 8`；`plan_frame_count(300, interval=8, min_frames=4, max_frames=12) == 12`（触顶）；`plan_frame_count(5, interval=8, min_frames=4, max_frames=12) == 4`（触底）；`plan_frame_count(0, ...) == 4`。
- `test_is_available_gate`：monkeypatch `shutil.which` 使 ffprobe 缺失时 `is_available() is False`。
- `test_probe_parses_json`（可选，标 `@pytest.mark.skipif(not VideoFrameExtractor.is_available())`）：对 ffmpeg 生成的 1s 测试视频（`ffmpeg -f lavfi -i testsrc=duration=1:size=320x240:rate=10 -y tmp.mp4`）跑 `probe()`，断言 `duration>0`、`width==320`。

**新建**：`tests/test_video_understand_tool.py`
- `test_missing_path`：`_tool_video_understand({}, session)` 以 `ERROR: missing required parameter 'path'.` 开头。
- `test_non_vision_model_blocked`：构造 `session.provider_name="minimax"`, `model_name="minimax-m2"`（`is_vision_capable` 返回 False），断言返回含 `does not support vision`。
- `test_ffmpeg_missing_hint`：monkeypatch `VideoFrameExtractor.is_available` -> False（且 session 为视觉模型、路径指向一个真实存在的小 .mp4 占位文件），断言返回含 `brew install ffmpeg`。
- `test_frames_staged_into_pending`（`skipif(not is_available())`）：用 ffmpeg 生成 2s testsrc mp4，视觉模型 session，调用工具后断言：返回文本含 `frames_attached=`；`_pending_visual_attachments(session)` 非空且每项 `data_url` 以 `data:image/png;base64,` 开头。

运行：`pytest tests/test_video_frames_adapter.py tests/test_video_understand_tool.py -q`

---

## AC（可执行验收）

- AC-P0-1：`pytest tests/test_video_frames_adapter.py tests/test_video_understand_tool.py -q` 全绿。
- AC-P0-2：`agx serve --host 127.0.0.1 --port <临时端口>` 冷启动不崩溃；`curl --noproxy '*' http://127.0.0.1:<port>/api/avatars` 返回 200（`agent_tools.py` 改动未破坏 `create_studio_app()`）。
- AC-P0-3：视觉模型下，对一个真实 mp4 调用 `video_understand`，对话下一轮模型能描述画面内容；工具返回文本含 `duration=`/`resolution=`/`frames_attached=`。
- AC-P0-4：长视频抽帧数 > 短视频（自适应生效，非固定 5 帧），且 ≤ 配置/硬上限。
- AC-P0-5：非视觉模型返回明确切换提示；未装 ffmpeg 返回 `brew install ffmpeg` 指引。

---

## In scope / Out of scope

**In scope**：新增 `video_frames.py` 适配器、`video_understand` 工具 schema/实现/dispatch、并发白名单一行、视频专用常量、config 读取辅助、两个冒烟测试。

**Out of scope**：不改 `_tool_view_image` 及其 4 帧上限；不改 `_inject_pending_visual_attachments`；不做音频转写（P1）；不改 Desktop（P2）；不改 `server.py` import 区；不引入新第三方 Python 依赖（仅用系统 ffmpeg/ffprobe）。

---

## Traceability
- Plan-Id: `2026-07-08-video-understanding-p0-frame-tool`
- Plan-File: `.cursor/plans/2026-07-08-video-understanding-p0-frame-tool.plan.md`
