import { describe, expect, it } from "vitest";
import {
  normalizeUserPreferenceWrite,
  pruneOrphanedOptOuts,
  resolveCapabilityState,
  resolveEffectiveCapabilities,
  type CapabilityAssignment,
} from "../capability-state";

describe("resolveCapabilityState", () => {
  it("lets the user subtract but never add", () => {
    expect(resolveCapabilityState(true, false)).toBe("on");
    expect(resolveCapabilityState(true, true)).toBe("off");
    // 企业停用时用户那一位无论是什么，结果都一样——这就是「不能反向开启」。
    expect(resolveCapabilityState(false, false)).toBe("unavailable");
    expect(resolveCapabilityState(false, true)).toBe("unavailable");
  });
});

describe("resolveEffectiveCapabilities", () => {
  const assignments: CapabilityAssignment[] = [
    { capabilityId: "mcp.market-data", enterpriseEnabled: true },
    { capabilityId: "skill.alphapai-research", enterpriseEnabled: true },
    { capabilityId: "mcp.retired-vendor", enterpriseEnabled: false },
  ];

  it("returns what the user may actually call", () => {
    expect(resolveEffectiveCapabilities(assignments, ["skill.alphapai-research"])).toEqual([
      "mcp.market-data",
    ]);
  });

  it("omits enterprise-disabled capabilities entirely rather than marking them disabled", () => {
    // 以 disabled 形式下发就等于指望客户端自觉，而紧急撤销不能建立在客户端自觉上。
    const effective = resolveEffectiveCapabilities(assignments);
    expect(effective).not.toContain("mcp.retired-vendor");
    expect(effective).toEqual(["mcp.market-data", "skill.alphapai-research"]);
  });

  it("cannot be re-enabled by a stale user opt-out record", () => {
    const disabled: CapabilityAssignment[] = [
      { capabilityId: "mcp.market-data", enterpriseEnabled: false },
    ];
    expect(resolveEffectiveCapabilities(disabled, [])).toEqual([]);
    expect(resolveEffectiveCapabilities(disabled, ["mcp.market-data"])).toEqual([]);
  });

  it("ignores blank and duplicate ids", () => {
    expect(
      resolveEffectiveCapabilities([
        { capabilityId: " ", enterpriseEnabled: true },
        { capabilityId: "a", enterpriseEnabled: true },
        { capabilityId: "a", enterpriseEnabled: true },
      ]),
    ).toEqual(["a"]);
  });

  it("accepts a Set as well as an array of opt-outs", () => {
    expect(resolveEffectiveCapabilities(assignments, new Set(["mcp.market-data"]))).toEqual([
      "skill.alphapai-research",
    ]);
  });
});

describe("normalizeUserPreferenceWrite", () => {
  it("accepts both directions while the enterprise allows the capability", () => {
    expect(normalizeUserPreferenceWrite(true, false)).toEqual({ accepted: true, disabledByUser: true });
    expect(normalizeUserPreferenceWrite(true, true)).toEqual({ accepted: true, disabledByUser: false });
  });

  it("rejects turning something on that the enterprise disabled", () => {
    // 静默存下会在企业重新启用的那一刻突然生效，等于绕过了当时的停用决定。
    expect(normalizeUserPreferenceWrite(false, true)).toEqual({
      accepted: false,
      reason: "enterprise_disabled",
    });
  });

  it("treats turning off an already-unavailable capability as idempotent", () => {
    expect(normalizeUserPreferenceWrite(false, false)).toEqual({ accepted: true, disabledByUser: true });
  });
});

describe("pruneOrphanedOptOuts", () => {
  it("drops opt-outs for capabilities the enterprise no longer grants", () => {
    const assignments: CapabilityAssignment[] = [
      { capabilityId: "a", enterpriseEnabled: true },
      { capabilityId: "b", enterpriseEnabled: false },
    ];
    expect(pruneOrphanedOptOuts(assignments, ["a", "b", "c"])).toEqual(["a"]);
  });
});
