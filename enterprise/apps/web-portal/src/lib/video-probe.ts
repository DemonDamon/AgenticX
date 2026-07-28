import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ulid } from "ulid";
import { MAX_PARSED_TEXT_CHARS } from "./attachment-parse-limits";

const execFile = promisify(execFileCb);

export type VideoParseResult = {
  parsedText: string;
  usedTools: Array<"ffprobe" | "ffmpeg" | "whisper">;
};

export type VideoProbeDeps = {
  execFile?: typeof execFile;
  access?: typeof access;
  mkdtemp?: typeof mkdtemp;
  writeFile?: typeof writeFile;
  readFile?: typeof readFile;
  rm?: typeof rm;
  tmpdir?: () => string;
  env?: NodeJS.ProcessEnv;
};

async function whichBin(
  name: string,
  deps: Pick<VideoProbeDeps, "execFile" | "access" | "env">,
): Promise<string | null> {
  const run = deps.execFile ?? execFile;
  const accessFn = deps.access ?? access;
  const env = deps.env ?? process.env;
  const envKey =
    name === "ffprobe"
      ? "AGX_FFPROBE_BIN"
      : name === "ffmpeg"
        ? "AGX_FFMPEG_BIN"
        : name === "whisper"
          ? "AGX_WHISPER_BIN"
          : "";
  const fromEnv = envKey ? env[envKey]?.trim() : "";
  if (fromEnv) {
    try {
      await accessFn(fromEnv, fsConstants.F_OK);
      return fromEnv;
    } catch {
      // fall through
    }
  }
  try {
    const { stdout } = await run(process.platform === "win32" ? "where" : "which", [name], {
      timeout: 5_000,
    });
    const first = stdout
      .toString()
      .split(/\r?\n/)
      .map((l) => l.trim())
      .find(Boolean);
    return first ?? null;
  } catch {
    return null;
  }
}

function truncateText(text: string, max = MAX_PARSED_TEXT_CHARS): string {
  const normalized = text.replace(/\u0000/g, "").replace(/\r\n/g, "\n").trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}\n\n…(已截断)`;
}

type FfprobeJson = {
  format?: { duration?: string; format_name?: string; size?: string };
  streams?: Array<{
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
  }>;
};

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "未知";
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m <= 0) return `${r}s`;
  return `${m}m${r.toString().padStart(2, "0")}s`;
}

function buildMetaMarkdown(
  name: string,
  probe: FfprobeJson | null,
): { markdown: string; durationSec: number | null } {
  const lines = [`【视频附件】${name}`, "", "## 元数据"];
  let durationSec: number | null = null;
  if (!probe) {
    lines.push("- 状态：未检测到 ffprobe，仅保留文件名");
    lines.push("- 说明：未解析画面/音轨内容；可安装 ffmpeg（含 ffprobe）以提取时长等信息");
    return { markdown: lines.join("\n"), durationSec };
  }
  const rawDur = probe.format?.duration ? Number(probe.format.duration) : NaN;
  if (Number.isFinite(rawDur)) durationSec = rawDur;
  const video = probe.streams?.find((s) => s.codec_type === "video");
  const audio = probe.streams?.find((s) => s.codec_type === "audio");
  lines.push(`- 时长：${durationSec != null ? formatDuration(durationSec) : "未知"}`);
  if (probe.format?.format_name) lines.push(`- 容器：${probe.format.format_name}`);
  if (video?.codec_name) lines.push(`- 视频编码：${video.codec_name}`);
  if (video?.width && video?.height) lines.push(`- 分辨率：${video.width}×${video.height}`);
  if (audio?.codec_name) lines.push(`- 音频编码：${audio.codec_name}`);
  lines.push("- 画面：未解析（当前不向模型发送视频帧）");
  return { markdown: lines.join("\n"), durationSec };
}

async function runFfprobe(
  inputPath: string,
  deps: VideoProbeDeps,
): Promise<{ json: FfprobeJson | null; bin: string | null }> {
  const bin = await whichBin("ffprobe", deps);
  if (!bin) return { json: null, bin: null };
  const run = deps.execFile ?? execFile;
  try {
    const { stdout } = await run(
      bin,
      ["-v", "quiet", "-print_format", "json", "-show_format", "-show_streams", inputPath],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );
    return { json: JSON.parse(stdout.toString()) as FfprobeJson, bin };
  } catch {
    return { json: null, bin };
  }
}

async function maybeTranscribe(
  inputPath: string,
  durationSec: number | null,
  deps: VideoProbeDeps,
): Promise<{ text: string | null; used: Array<"ffmpeg" | "whisper"> }> {
  const env = deps.env ?? process.env;
  if (env.AGX_VIDEO_ASR !== "1") return { text: null, used: [] };
  const maxSec = Number(env.AGX_VIDEO_ASR_MAX_SECONDS ?? "180");
  const cap = Number.isFinite(maxSec) && maxSec > 0 ? maxSec : 180;
  if (durationSec != null && durationSec > cap) {
    return { text: null, used: [] };
  }

  const ffmpeg = await whichBin("ffmpeg", deps);
  const whisper = await whichBin("whisper", deps);
  if (!ffmpeg || !whisper) return { text: null, used: [] };

  const run = deps.execFile ?? execFile;
  const makeTemp = deps.mkdtemp ?? mkdtemp;
  const write = deps.writeFile ?? writeFile;
  const read = deps.readFile ?? readFile;
  const remove = deps.rm ?? rm;
  const baseTmp = deps.tmpdir ?? tmpdir;
  const work = await makeTemp(join(baseTmp(), "agx-video-asr-"));
  const wavPath = join(work, "audio.wav");
  const used: Array<"ffmpeg" | "whisper"> = [];

  try {
    await run(
      ffmpeg,
      ["-y", "-i", inputPath, "-vn", "-ac", "1", "-ar", "16000", wavPath],
      { timeout: 60_000 },
    );
    used.push("ffmpeg");
    const { stdout } = await run(
      whisper,
      [wavPath, "--model", env.AGX_WHISPER_MODEL?.trim() || "base", "--output_format", "txt", "--output_dir", work],
      { timeout: 180_000, maxBuffer: 8 * 1024 * 1024 },
    );
    used.push("whisper");
    // whisper typically writes audio.txt beside wav
    let transcript = "";
    try {
      transcript = (await read(join(work, "audio.txt"))).toString("utf8");
    } catch {
      transcript = stdout.toString("utf8");
    }
    const trimmed = transcript.trim();
    return { text: trimmed || null, used };
  } catch {
    return { text: null, used };
  } finally {
    await remove(work, { recursive: true, force: true }).catch(() => undefined);
  }
}

export async function parseVideoAttachment(
  file: { name: string; buffer: Buffer },
  deps: VideoProbeDeps = {},
): Promise<VideoParseResult> {
  const makeTemp = deps.mkdtemp ?? mkdtemp;
  const write = deps.writeFile ?? writeFile;
  const remove = deps.rm ?? rm;
  const baseTmp = deps.tmpdir ?? tmpdir;
  const usedTools: VideoParseResult["usedTools"] = [];

  const dir = await makeTemp(join(baseTmp(), "agx-video-"));
  const ext = file.name.includes(".") ? file.name.split(".").pop()!.toLowerCase() : "mp4";
  const inputPath = join(dir, `clip-${ulid().toLowerCase()}.${ext}`);

  try {
    await write(inputPath, file.buffer);
    const { json, bin } = await runFfprobe(inputPath, deps);
    if (bin) usedTools.push("ffprobe");
    const { markdown, durationSec } = buildMetaMarkdown(file.name, json);
    const asr = await maybeTranscribe(inputPath, durationSec, deps);
    usedTools.push(...asr.used);

    let body = markdown;
    if (asr.text) {
      body += `\n\n## 语音转写\n${asr.text}`;
    } else if ((deps.env ?? process.env).AGX_VIDEO_ASR === "1") {
      body += `\n\n## 语音转写\n（未生成：请确认已安装 ffmpeg + whisper，且时长 ≤ AGX_VIDEO_ASR_MAX_SECONDS）`;
    } else {
      body += `\n\n## 语音转写\n（未启用；设置 AGX_VIDEO_ASR=1 且安装 ffmpeg/whisper 后可对短视频转写）`;
    }

    return { parsedText: truncateText(body), usedTools };
  } finally {
    await remove(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}
