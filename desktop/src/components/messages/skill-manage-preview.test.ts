import { describe, expect, it } from "vitest";
import { parseSkillManageError, parseSkillPatchPreviewPayload } from "./skill-manage-preview";

describe("parseSkillPatchPreviewPayload", () => {
  it("parses valid preview payload", () => {
    const raw = JSON.stringify({
      ok: true,
      action: "patch",
      mode: "preview",
      strategy: "exact",
      match_count: 1,
      patch_token: "tok",
      target_ranges: [{ start: 1, end: 5, start_line: 2, end_line: 2 }],
      risk: { verdict: "safe", allowed: true, reason: "ok", findings: ["x"] },
      diff: "---",
    });
    const parsed = parseSkillPatchPreviewPayload(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.action).toBe("patch");
    expect(parsed?.mode).toBe("preview");
    expect(parsed?.target_ranges?.[0]?.start_line).toBe(2);
  });

  it("returns null for non-preview payload", () => {
    const raw = JSON.stringify({ ok: true, action: "patch", mode: "apply" });
    expect(parseSkillPatchPreviewPayload(raw)).toBeNull();
  });
});

describe("parseSkillManageError", () => {
  it("parses validation error", () => {
    const parsed = parseSkillManageError("ERROR[VALIDATION]: bad request");
    expect(parsed).toEqual({ code: "VALIDATION", detail: "bad request" });
  });

  it("parses policy error", () => {
    const parsed = parseSkillManageError("ERROR[POLICY]: blocked");
    expect(parsed).toEqual({ code: "POLICY", detail: "blocked" });
  });
});
