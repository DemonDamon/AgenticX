import { describe, expect, it, vi } from "vitest";
import { parseVideoAttachment } from "./video-probe";

describe("parseVideoAttachment", () => {
  it("returns friendly placeholder when ffprobe is missing", async () => {
    const execFile = vi.fn().mockRejectedValue(new Error("not found"));
    const access = vi.fn().mockRejectedValue(new Error("missing"));
    const result = await parseVideoAttachment(
      { name: "clip.mp4", buffer: Buffer.from("bytes") },
      {
        execFile,
        access,
        env: {},
        mkdtemp: async () => "/tmp/agx-video-test",
        writeFile: async () => undefined,
        readFile: async () => Buffer.from(""),
        rm: async () => undefined,
        tmpdir: () => "/tmp",
      },
    );
    expect(result.parsedText).toContain("clip.mp4");
    expect(result.parsedText).toMatch(/未检测到 ffprobe|仅保留文件名/);
    expect(result.usedTools).toEqual([]);
  });

  it("includes duration when ffprobe returns JSON", async () => {
    const probeJson = JSON.stringify({
      format: { duration: "12.5", format_name: "mp4" },
      streams: [
        { codec_type: "video", codec_name: "h264", width: 1280, height: 720 },
        { codec_type: "audio", codec_name: "aac" },
      ],
    });
    const execFile = vi.fn().mockImplementation(async (bin: string, args: string[]) => {
      if (bin === "which" || bin === "where") {
        if (args[0] === "ffprobe") return { stdout: "/usr/bin/ffprobe\n", stderr: "" };
        throw new Error("not found");
      }
      if (bin === "/usr/bin/ffprobe") {
        return { stdout: probeJson, stderr: "" };
      }
      throw new Error(`unexpected ${bin}`);
    });

    const result = await parseVideoAttachment(
      { name: "demo.mp4", buffer: Buffer.from("bytes") },
      {
        execFile,
        access: async () => undefined,
        env: {},
        mkdtemp: async () => "/tmp/agx-video-test2",
        writeFile: async () => undefined,
        rm: async () => undefined,
        tmpdir: () => "/tmp",
      },
    );

    expect(result.usedTools).toContain("ffprobe");
    expect(result.parsedText).toMatch(/时长/);
    expect(result.parsedText).toMatch(/1[23]s|0m1[23]s/);
    expect(result.parsedText).toContain("h264");
  });

  it("does not throw when ASR enabled but tools timeout/fail", async () => {
    const probeJson = JSON.stringify({
      format: { duration: "5", format_name: "mp4" },
      streams: [{ codec_type: "video", codec_name: "h264", width: 640, height: 360 }],
    });
    const execFile = vi.fn().mockImplementation(async (bin: string, args: string[]) => {
      if (bin === "which" || bin === "where") {
        if (["ffprobe", "ffmpeg", "whisper"].includes(args[0] ?? "")) {
          return { stdout: `/usr/bin/${args[0]}\n`, stderr: "" };
        }
        throw new Error("not found");
      }
      if (String(bin).includes("ffprobe")) {
        return { stdout: probeJson, stderr: "" };
      }
      // ffmpeg/whisper fail
      throw new Error("timeout");
    });

    const result = await parseVideoAttachment(
      { name: "short.mp4", buffer: Buffer.from("bytes") },
      {
        execFile,
        access: async () => undefined,
        env: { AGX_VIDEO_ASR: "1", AGX_VIDEO_ASR_MAX_SECONDS: "180" },
        mkdtemp: async (prefix: string) => `${prefix}x`,
        writeFile: async () => undefined,
        rm: async () => undefined,
        tmpdir: () => "/tmp",
      },
    );

    expect(result.parsedText).toContain("short.mp4");
    expect(result.parsedText).toMatch(/时长/);
    // degraded ASR note, not thrown
    expect(result.parsedText).toMatch(/语音转写|未生成/);
  });
});
