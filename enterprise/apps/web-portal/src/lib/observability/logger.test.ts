import { afterEach, describe, expect, it, vi } from "vitest";
import { log } from "./logger";

describe("portal structured logger", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("emits one JSON-parseable line", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log("info", { event: "chat.completions.finish", trace_id: "01JABCDEFGHJKMNPQRSTVWXYZA" });
    expect(spy).toHaveBeenCalledOnce();
    const line = String(spy.mock.calls[0]?.[0]);
    const parsed = JSON.parse(line) as { level: string; event: string };
    expect(parsed.level).toBe("info");
    expect(parsed.event).toBe("chat.completions.finish");
  });

  it("redacts authorization and messages content", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log("info", {
      event: "test.redact",
      authorization: "Bearer secret-token",
      messages: [{ role: "user", content: "private prompt body" }],
    });
    const line = String(spy.mock.calls[0]?.[0]);
    expect(line).not.toContain("Bearer");
    expect(line).not.toContain("secret-token");
    expect(line).not.toContain("private prompt body");
    expect(line).toContain("[redacted]");
  });

  it("honors PORTAL_LOG_LEVEL=warn by dropping info", () => {
    vi.stubEnv("PORTAL_LOG_LEVEL", "warn");
    const spy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    log("info", { event: "should.not.appear" });
    expect(spy).not.toHaveBeenCalled();
  });

  it("truncates error_stack to 2000 chars", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const longStack = "x".repeat(5000);
    log("error", { event: "test.stack", error_stack: longStack });
    const line = String(spy.mock.calls[0]?.[0]);
    const parsed = JSON.parse(line) as { error_stack: string };
    expect(parsed.error_stack).toHaveLength(2000);
  });
});
