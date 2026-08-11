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

  it("skips deep_research.runs success finish but still logs chat.completions", async () => {
    vi.stubEnv("PORTAL_LOG_LEVEL", "debug");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await withRequestLog("deep_research.runs", async () => new Response("ok", { status: 200 }));
    await withRequestLog("chat.completions", async () => new Response("ok", { status: 200 }));

    const parsed = lines
      .map((line) => {
        try {
          return JSON.parse(line) as { event?: string; level?: string };
        } catch {
          return null;
        }
      })
      .filter((row): row is { event?: string; level?: string } => Boolean(row));

    expect(parsed.some((row) => row.event === "deep_research.runs.finish")).toBe(false);
    const chatFinish = parsed.find((row) => row.event === "chat.completions.finish");
    expect(chatFinish?.level).toBe("info");
  });

  it("still logs error level on polling route failure", async () => {
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errors.push(String(line));
    });

    await expect(
      withRequestLog("deep_research.runs", async () => {
        throw new Error("poll boom");
      }),
    ).rejects.toThrow("poll boom");

    const parsed = errors.map((line) => JSON.parse(line) as { event: string; level: string });
    const errRow = parsed.find((row) => row.event === "deep_research.runs.error");
    expect(errRow?.level).toBe("error");
  });

  it("defaults mode to chat and honors setMode(deep_research)", async () => {
    vi.stubEnv("PORTAL_LOG_LEVEL", "debug");
    const lines: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await withRequestLog("chat.completions", async () => new Response("ok", { status: 200 }));
    await withRequestLog("chat.completions", async (ctx) => {
      ctx.setMode("deep_research");
      ctx.setRun("01JTESTMODE000000000000001");
      return new Response("ok", { status: 200 });
    });

    const parsed = lines
      .map((line) => {
        try {
          return JSON.parse(line) as { event?: string; mode?: string; run_id?: string };
        } catch {
          return null;
        }
      })
      .filter((row): row is { event?: string; mode?: string; run_id?: string } => Boolean(row));

    const finishes = parsed.filter((row) => row.event === "chat.completions.finish");
    expect(finishes).toHaveLength(2);
    expect(finishes[0]?.mode).toBe("chat");
    expect(finishes[1]?.mode).toBe("deep_research");
    expect(finishes[1]?.run_id).toBe("01JTESTMODE000000000000001");
  });

  it("skips success finish after markNoop but still logs errors", async () => {
    vi.stubEnv("PORTAL_LOG_LEVEL", "debug");
    const lines: string[] = [];
    const errors: string[] = [];
    vi.spyOn(console, "log").mockImplementation((line: unknown) => {
      lines.push(String(line));
    });
    vi.spyOn(console, "error").mockImplementation((line: unknown) => {
      errors.push(String(line));
    });

    await withRequestLog("deep_research.resume", async (ctx) => {
      ctx.markNoop();
      return new Response("ok", { status: 200 });
    });

    await expect(
      withRequestLog("deep_research.resume", async (ctx) => {
        ctx.markNoop();
        throw new Error("resume boom");
      }),
    ).rejects.toThrow("resume boom");

    const parsed = lines
      .map((line) => {
        try {
          return JSON.parse(line) as { event?: string };
        } catch {
          return null;
        }
      })
      .filter((row): row is { event?: string } => Boolean(row));
    expect(parsed.some((row) => row.event === "deep_research.resume.finish")).toBe(false);

    const errParsed = errors.map((line) => JSON.parse(line) as { event: string; level: string });
    const errRow = errParsed.find((row) => row.event === "deep_research.resume.error");
    expect(errRow?.level).toBe("error");
  });
});
