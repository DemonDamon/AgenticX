import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseSse, type SseFrame } from "./sse";

const casesPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../tests/fixtures/managed_agents/client_cases.json",
);
const cases = JSON.parse(readFileSync(casesPath, "utf8")) as { stream_part1: string };

function streamFrom(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

async function framesFrom(text: string, cuts: number[]): Promise<SseFrame[]> {
  const bytes = new TextEncoder().encode(text);
  const points = [0, ...cuts, bytes.length];
  const chunks: Uint8Array[] = [];
  for (let index = 0; index < points.length - 1; index += 1) {
    const start = points[index] ?? 0;
    const end = points[index + 1] ?? bytes.length;
    chunks.push(bytes.slice(start, end));
  }
  const frames: SseFrame[] = [];
  for await (const frame of parseSse(streamFrom(chunks))) frames.push(frame);
  return frames;
}

describe("parseSse", () => {
  it("reassembles frames split across arbitrary chunks", async () => {
    const text = cases.stream_part1;
    const third = Math.floor(text.length / 3);
    const frames = await framesFrom(text, [1, third]);
    expect(frames.map((frame) => frame.id)).toEqual(["2", null, "3"]);
    expect(frames[0]?.event).toBe("session.status_running");
    expect(frames[1]?.event).toBe("event_delta");
    expect(frames[2]?.data).toContain("hello");
  });

  it("treats CRLF the same as LF", async () => {
    const lf = await framesFrom(cases.stream_part1, [4, 20]);
    const crlf = await framesFrom(cases.stream_part1.replaceAll("\n", "\r\n"), [5, 30]);
    expect(crlf).toEqual(lf);
  });

  it("joins multiline data with newlines", async () => {
    const frames = await framesFrom("data: hello\ndata: world\n\n", [6]);
    expect(frames).toEqual([{ id: null, event: "message", data: "hello\nworld" }]);
  });
});
