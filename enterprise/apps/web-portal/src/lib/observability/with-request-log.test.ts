import { afterEach, describe, expect, it, vi } from "vitest";
import { isTraceId } from "@agenticx/sdk-ts";
import { withRequestLog } from "./with-request-log";

describe("withRequestLog", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("logs start+finish and attaches trace response header on success", async () => {
    vi.stubEnv("PORTAL_LOG_LEVEL", "debug");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await withRequestLog("chat.completions", async (ctx) => {
      ctx.setUser({ userId: "u1", tenantId: "t1", sessionId: "s1" });
      return new Response("ok", { status: 200 });
    });

    expect(response.status).toBe(200);
    expect(isTraceId(response.headers.get("x-agenticx-trace-id"))).toBe(true);

    const parsed = lines
      .map((line) => {
        try {
          return JSON.parse(line) as { event?: string; duration_ms?: number };
        } catch {
          return null;
        }
      })
      .filter((row): row is { event?: string; duration_ms?: number } => Boolean(row));

    expect(parsed.some((row) => row.event === "chat.completions.start")).toBe(true);
    const finish = parsed.find((row) => row.event === "chat.completions.finish");
    expect(finish).toBeTruthy();
    expect((finish?.duration_ms ?? -1) >= 0).toBe(true);
  });

  it("logs error and rethrows when handler fails", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errors.push(String(line));
    });

    await expect(
      withRequestLog("chat.completions", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    const parsed = errors.map((line) => JSON.parse(line) as { event: string; error_message: string });
    expect(parsed.some((row) => row.event === "chat.completions.error")).toBe(true);
    expect(parsed.some((row) => row.error_message === "boom")).toBe(true);
  });

  it("attaches trace header even when handler omits it", async () => {
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    const response = await withRequestLog("deep_research.runs", async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    expect(isTraceId(response.headers.get("x-agenticx-trace-id"))).toBe(true);
  });
});
