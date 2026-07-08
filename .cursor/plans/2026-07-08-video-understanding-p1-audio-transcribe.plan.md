# P1：视频音频转写融合（可选 / 可降级）

Planned-with: claude-opus-4.8
Suggested-Impl-Model: gpt-5.3-codex

> 依赖 P0 已合入（`_tool_video_understand` + `VideoFrameExtractor` 已存在）。本子规划让含语音的视频在视觉抽帧之外，额外抽音轨转写成文本，随工具返回一起交给模型，解决"纯抽帧丢语音信息"的问题。**转写失败/后端未配置必须优雅降级，绝不破坏 P0 的视觉链路。**

---

## 根因/依据

- P0 返回文本里已对有音轨的视频注明"未转写"。P1 补上转写。
- 仓库**已有**可复用的转写后端（`agenticx/studio/voice_endpoints.py`）：
  - `_resolve_transcribe_provider()`（`voice_endpoints.py:217`）→ 返回 `"openai_whisper"` / `"doubao_flash"` / `""`（空表示无可用后端）。
  - `_transcribe_openai_whisper(raw, *, filename, content_type, language)`（`voice_endpoints.py:259`）→ POST `/v1/audio/transcriptions`，返回文本；失败抛 `HTTPException`。
  - `_transcribe_doubao_flash(raw)`（`voice_endpoints.py:297`）→ 豆包 flash 文件 ASR；失败抛 `HTTPException`。
- 抽音轨：用 P0 已依赖的系统 ffmpeg，把视频音轨转成 whisper 友好的单声道 16k mp3/wav。

---

## 变更点 1：适配器新增音频抽取

文件：`agenticx/tools/adapters/video_frames.py`（P0 新建的文件）

在 `VideoFrameExtractor` 中**新增**方法（精确增方法，不改 P0 既有方法）：

```python
    async def extract_audio(self, path: Path, out_dir: Path) -> Optional[Path]:
        """Extract mono 16k mp3 audio track. Returns None if the source has no audio
        or ffmpeg fails (caller must treat None as 'no transcription available')."""
        # cmd: [ffmpeg, -y, -i, str(path), -vn, -ac, 1, -ar, 16000, -b:a, 64k, out_dir/audio.mp3]
        # If returncode != 0 OR output file missing/zero-size -> return None (do NOT raise).
        ...
```

约束：
- `-vn`（去视频）`-ac 1 -ar 16000`（单声道 16k，减小体积、贴合 ASR）。
- 任何失败（无音轨、编码失败）返回 `None`，**不抛异常**（转写是增强，不能阻断）。
- 产物大小若 > 24MB（whisper-1 上限约 25MB）则截断/降码率或返回 `None` 并让工具层记降级原因。

---

## 变更点 2：工具层融合转写（改 `_tool_video_understand`）

文件：`agenticx/cli/agent_tools.py`

### 2.1 config 开关

在 P0 的 `_video_understand_settings()` 返回字典中**新增** `enable_audio_transcription`（读 `video_understanding.enable_audio_transcription`，默认 `True`，即"有音轨且后端可用就转"）与 `transcription_language`（默认 `""`，交由后端自动/回落 `zh`）。仅在该函数的返回 dict 内增键，不改其它逻辑。

### 2.2 转写辅助函数（新增）

在 `_tool_video_understand` 之前新增：

```python
async def _transcribe_video_audio(audio_path: Path, language: str) -> tuple[str, str]:
    """Best-effort transcription. Returns (transcript, degrade_reason).

    On any failure or when no backend is configured, returns ("", <reason>) so the
    caller can keep the visual chain intact.
    """
    try:
        from agenticx.studio.voice_endpoints import (
            _resolve_transcribe_provider,
            _transcribe_openai_whisper,
            _transcribe_doubao_flash,
        )
    except Exception as exc:  # module import guarded; never fatal
        return "", f"transcription module unavailable: {exc}"

    provider = ""
    try:
        provider = _resolve_transcribe_provider()
    except Exception as exc:
        return "", f"transcribe provider resolve failed: {exc}"
    if not provider:
        return "", "no transcription backend configured (see 设置 → 语音)"

    try:
        raw = audio_path.read_bytes()
    except OSError as exc:
        return "", f"cannot read extracted audio: {exc}"

    try:
        if provider == "openai_whisper":
            text = await _transcribe_openai_whisper(
                raw, filename=audio_path.name, content_type="audio/mpeg", language=(language or "zh")
            )
        elif provider == "doubao_flash":
            text = await _transcribe_doubao_flash(raw)
        else:
            return "", f"unknown transcription provider: {provider}"
    except Exception as exc:  # HTTPException etc. -> degrade, do not break视觉链路
        return "", f"transcription failed ({provider}): {exc}"
    return (text or "").strip(), ""
```

> 说明：`_transcribe_openai_whisper` 等原为 FastAPI 端点内部函数、失败抛 `HTTPException`；此处 `except Exception` 兜住并降级，符合"转写不得阻断视觉"的原则，也符合"失败要透出可读原因"的偏好（`degrade_reason` 写入返回文本）。

### 2.3 在工具主流程接入（改 `_tool_video_understand`）

在 P0 版本"帧已 staged、准备生成返回文本"处（P0 步骤 5 之前）新增转写分支。**只在如下条件全部成立时转写**：`probe.has_audio` 为真 且 `settings["enable_audio_transcription"]` 为真。伪代码 before/after：

before（P0）：
```python
    audio_note = "with audio track" if probe.has_audio else "no audio track"
    lines = [ ... ]
    if probe.has_audio:
        lines.append("NOTE: ... NOT transcribed in this build; ...")
    return "\n".join(lines)
```

after（P1）：
```python
    transcript = ""
    degrade_reason = ""
    if probe.has_audio and settings.get("enable_audio_transcription", True):
        # tmp_dir was rmtree'd in the finally of P0; re-extract audio into a fresh temp dir
        # OR (preferred) move audio extraction BEFORE the finally cleanup. See note below.
        ...
    audio_note = (
        "with audio (transcribed)" if transcript
        else ("with audio (not transcribed)" if probe.has_audio else "no audio track")
    )
    lines = [
        f"[video_understand] {path.name}",
        f"duration={probe.duration_seconds:.1f}s resolution={probe.width}x{probe.height} "
        f"{audio_note} strategy={result.strategy} frames_attached={staged}",
        "Frames are attached as images in the NEXT turn; combine them with the transcript below.",
    ]
    if transcript:
        clipped = transcript if len(transcript) <= 6000 else transcript[:6000] + " …[truncated]"
        lines.append("")
        lines.append("[audio_transcript]")
        lines.append(clipped)
    elif probe.has_audio:
        lines.append(f"NOTE: audio present but not transcribed ({degrade_reason or 'unknown'}).")
    return "\n".join(lines)
```

**重要实现顺序调整**：P0 在 `finally: shutil.rmtree(tmp_dir)` 里清理临时目录。P1 需要音频文件在转写前存在，因此实施者须把「抽音轨 + 转写」放在 P0 的 `try` 块内、`finally` 清理**之前**完成（即在同一个 `tmp_dir` 生命周期内 `extract_audio` + `_transcribe_video_audio`，把 `transcript/degrade_reason` 存到外层变量，再在 finally 之后拼接返回文本）。**只调整语句顺序，不改帧 staging 逻辑**。

---

## 变更点 3：config 文档

若 P0 已在配置示例中加了 `video_understanding` 节，则补两行；否则不新建文件：

```yaml
video_understanding:
  enable_audio_transcription: true   # requires 设置→语音 配置了 openai/doubao 转写后端
  transcription_language: ""         # empty -> backend default / zh
```

---

## 冒烟测试

**扩展**：`tests/test_video_understand_tool.py`
- `test_transcription_degrades_when_no_backend`：monkeypatch `_resolve_transcribe_provider` -> `""`；`_transcribe_video_audio(tmpfile, "")` 返回 `("", <含 'no transcription backend'>)`；不抛异常。
- `test_transcription_failure_degrades`：monkeypatch provider -> `"openai_whisper"`，并让 `_transcribe_openai_whisper` 抛异常；断言返回 `("", <含 'transcription failed'>)`。
- `test_has_audio_no_backend_note`（`skipif(not VideoFrameExtractor.is_available())`）：用 ffmpeg 生成带音轨的 2s mp4（`ffmpeg -f lavfi -i testsrc=duration=2:size=320x240:rate=10 -f lavfi -i sine=frequency=440:duration=2 -y tmp.mp4`），无转写后端配置下调用工具，断言返回文本含 `audio present but not transcribed` 且仍含 `frames_attached=`（视觉链路未被破坏）。

**扩展**：`tests/test_video_frames_adapter.py`
- `test_extract_audio_none_on_silent`（`skipif(not is_available())`）：对无音轨视频 `extract_audio` 返回 `None`，不抛异常。

运行：`pytest tests/test_video_understand_tool.py tests/test_video_frames_adapter.py -q`

---

## AC

- AC-P1-1：含语音视频 + 已配置转写后端时，工具返回文本含 `[audio_transcript]` 段，模型能结合画面与语音作答。
- AC-P1-2：无转写后端 / 转写失败时，工具仍正常返回帧 + `audio present but not transcribed (原因)`，**视觉理解不受影响**（AC-P1 冒烟用例覆盖）。
- AC-P1-3：无音轨视频不触发转写、不产生降级噪音。
- AC-P1-4：`agx serve` 冷启动核心 API 200；相关冒烟测试全绿。

---

## In scope / Out of scope

**In scope**：适配器 `extract_audio`、工具层转写融合与降级、复用 `voice_endpoints` 现有转写函数、config 两个开关、冒烟测试扩展、把音频转写插入到 P0 临时目录清理之前的语句顺序调整。

**Out of scope**：不新增第三方 ASR 依赖（复用现有 openai/doubao 后端）；不改 `voice_endpoints.py` 现有函数签名/行为（只调用）；不改前端（P2）；不改说话人分离/时间轴对齐（超出本次范围，如需另立 plan）。

---

## Traceability
- Plan-Id: `2026-07-08-video-understanding-p1-audio-transcribe`
- Plan-File: `.cursor/plans/2026-07-08-video-understanding-p1-audio-transcribe.plan.md`
