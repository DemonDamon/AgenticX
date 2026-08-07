import { describe, expect, it } from "vitest";
import { parseClarifyResumeResponse } from "./deep-research-clarify-resume";

describe("parseClarifyResumeResponse", () => {
  it("treats 200 resumed as success", () => {
    expect(
      parseClarifyResumeResponse(
        200,
        JSON.stringify({ code: "00000", data: { runId: "r1", resumed: true } }),
      ),
    ).toEqual({ kind: "resumed" });
  });

  it("treats 200 alreadyContinued as soft success with Chinese copy", () => {
    const result = parseClarifyResumeResponse(
      200,
      JSON.stringify({
        code: "00000",
        data: { runId: "r1", resumed: false, alreadyContinued: true },
      }),
    );
    expect(result.kind).toBe("already_continued");
    if (result.kind === "already_continued") {
      expect(result.message).toContain("澄清窗口已结束");
      expect(result.message).not.toContain("{");
    }
  });

  it("uses plan-specific copy when gate is plan", () => {
    const result = parseClarifyResumeResponse(
      200,
      JSON.stringify({
        code: "00000",
        data: { runId: "r1", resumed: false, alreadyContinued: true },
      }),
      "plan",
    );
    expect(result.kind).toBe("already_continued");
    if (result.kind === "already_continued") {
      expect(result.message).toContain("计划确认已结束");
      expect(result.message).not.toContain("澄清窗口");
    }
  });

  it("maps legacy 40401 JSON to soft success instead of raw dump", () => {
    const raw = JSON.stringify({
      error: { code: "40401", message: "no pending clarify for runId" },
    });
    const result = parseClarifyResumeResponse(404, raw);
    expect(result.kind).toBe("already_continued");
    if (result.kind === "already_continued") {
      expect(result.message).not.toContain("40401");
      expect(result.message).not.toContain("no pending clarify");
    }
  });

  it("maps other HTTP failures to short Chinese without JSON bodies", () => {
    const result = parseClarifyResumeResponse(
      500,
      JSON.stringify({ error: { code: "50001", message: "upstream failed" } }),
    );
    expect(result).toEqual({ kind: "error", message: "upstream failed" });

    const opaque = parseClarifyResumeResponse(502, "<html>bad gateway</html>");
    expect(opaque).toEqual({ kind: "error", message: "提交失败（HTTP 502）" });
  });
});
