import { describe, expect, it } from "vitest";
import {
  SANDBOX_TIER_OPTIONS,
  normalizeSandboxTier,
  sandboxNotices,
} from "./sandbox-status";

describe("normalizeSandboxTier", () => {
  it("falls back to workspace-write for missing or unknown values", () => {
    expect(normalizeSandboxTier(undefined)).toBe("workspace-write");
    expect(normalizeSandboxTier("")).toBe("workspace-write");
    expect(normalizeSandboxTier("weird")).toBe("workspace-write");
  });

  it("returns legal values as-is", () => {
    expect(normalizeSandboxTier("read-only")).toBe("read-only");
    expect(normalizeSandboxTier("workspace-write")).toBe("workspace-write");
    expect(normalizeSandboxTier("danger-full-access")).toBe("danger-full-access");
  });
});

describe("SANDBOX_TIER_OPTIONS", () => {
  it("has three unique values with non-empty descriptions", () => {
    expect(SANDBOX_TIER_OPTIONS).toHaveLength(3);
    const values = SANDBOX_TIER_OPTIONS.map((option) => option.value);
    expect(new Set(values).size).toBe(3);
    for (const option of SANDBOX_TIER_OPTIONS) {
      expect(option.description.trim()).not.toBe("");
    }
  });

  it("says confirmation is still required for danger-full-access", () => {
    const danger = SANDBOX_TIER_OPTIONS.find((option) => option.value === "danger-full-access");
    expect(danger?.description).toContain("确认");
  });
});

describe("sandboxNotices", () => {
  it("warns that files outside the workspace can still be read", () => {
    const notices = sandboxNotices({ shellReadIsolation: "none" });
    expect(notices.some((notice) => notice.tone === "warn")).toBe(true);
    expect(notices.some((notice) => notice.text.includes("工作区之外"))).toBe(true);
  });

  it("mentions partial path-deny enforcement", () => {
    const notices = sandboxNotices({ pathDenyEnforcement: "partial" });
    expect(notices.some((notice) => notice.text.includes("部分"))).toBe(true);
  });

  it("treats missing fields conservatively", () => {
    const notices = sandboxNotices({});
    expect(notices.length).toBeGreaterThan(0);
    expect(notices.every((notice) => notice.tone === "warn")).toBe(true);
  });

  it("returns separate sentences for full isolation and full path deny", () => {
    const notices = sandboxNotices({
      shellReadIsolation: "full",
      pathDenyEnforcement: "full",
    });
    expect(notices.length).toBeGreaterThanOrEqual(2);
  });
});
