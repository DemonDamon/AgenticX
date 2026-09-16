import { beforeEach, describe, expect, it, vi } from "vitest";

const loadUserCapabilityView = vi.fn();
const setUserOptOut = vi.fn();

vi.mock("@agenticx/iam-core", () => ({
  listUserOptOuts: vi.fn(async () => []),
  resolveAssignmentKeysForUser: vi.fn(async () => ["all"]),
  setUserOptOut: (...args: unknown[]) => setUserOptOut(...args),
}));

vi.mock("../capability-tables", () => ({
  requiredCapabilityTenant: () => "tenant-1",
}));

vi.mock("../capability-packs-reader", async () => {
  const actual = await vi.importActual<typeof import("../capability-packs-reader")>(
    "../capability-packs-reader",
  );
  return {
    ...actual,
    loadUserCapabilityView: (...args: unknown[]) => loadUserCapabilityView(...args),
  };
});

const SKILL_ID = "skill:01JQMZ8K3N4P5Q6R7S8T9VWXY0";
const MCP_ID = "mcp:01JQMZ8K3N4P5Q6R7S8T9VWXYZ";

describe("setUserCapabilityPreference", () => {
  beforeEach(() => {
    loadUserCapabilityView.mockReset();
    setUserOptOut.mockReset().mockResolvedValue(undefined);
    loadUserCapabilityView.mockResolvedValue({
      assigned: [
        {
          id: SKILL_ID,
          kind: "skill",
          name: "s",
          displayName: "S",
          requires: [],
          surfaces: ["web", "desktop"],
        },
        {
          id: MCP_ID,
          kind: "mcp",
          name: "m",
          displayName: "M",
          requires: [],
          surfaces: ["web", "desktop"],
        },
      ],
      assignedPlatformFeatures: new Set(),
      optOuts: new Set<string>(),
    });
  });

  it("records an opt-out and returns the skill as off", async () => {
    const { setUserCapabilityPreference } = await import("../capability-opt-outs-store");
    const result = await setUserCapabilityPreference("u1", "a@example.invalid", "d1", SKILL_ID, false);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(setUserOptOut).toHaveBeenCalledWith("tenant-1", "u1", SKILL_ID, true);
    expect(result.capabilities.find((item) => item.id === SKILL_ID)?.state).toBe("off");
    expect(result.capabilities.find((item) => item.id === MCP_ID)?.state).toBe("on");
  });

  it("rejects turning on a capability the enterprise has not assigned", async () => {
    const { setUserCapabilityPreference } = await import("../capability-opt-outs-store");
    const result = await setUserCapabilityPreference(
      "u1",
      "a@example.invalid",
      "d1",
      "skill:01JQMZ8K3N4P5Q6R7S8T9VWXY9",
      true,
    );

    expect(result).toEqual({ ok: false, reason: "enterprise_disabled" });
    expect(setUserOptOut).not.toHaveBeenCalled();
  });
});
