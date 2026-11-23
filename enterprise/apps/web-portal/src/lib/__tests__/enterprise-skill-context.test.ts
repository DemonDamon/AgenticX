import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  loadSkillBody: vi.fn(), log: vi.fn(), buildBlock: vi.fn(),
  states: [{ id: "skill:test", kind: "skill", displayName: "Test", description: "", state: "on", scanVerdict: "safe",
    bundleUri: "https://cdn.example.com/SKILL.md", bundleDigest: "a".repeat(64) }],
}));
vi.mock("../capability-packs-reader", () => ({
  loadUserCapabilityView: async () => ({}), capabilityStatesFromView: () => mocks.states,
}));
vi.mock("../enterprise-skill-bundle", () => ({ loadSkillBody: mocks.loadSkillBody }));
vi.mock("../enterprise-skill-prompt", () => ({
  buildEnterpriseSkillBlock: mocks.buildBlock, withEnterpriseSkillContext: (messages: unknown) => messages,
}));
vi.mock("../observability/logger", () => ({ log: mocks.log }));
import { applyAssignedSkillPrompt } from "../enterprise-skill-context";

describe("assigned Skill download contract", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.loadSkillBody.mockResolvedValue("safe body"); });
  it("passes the assigned digest to the downloader before adding the focused body", async () => {
    await applyAssignedSkillPrompt({ messages: [], userId: "user-1", focusedId: "skill:test" });
    expect(mocks.loadSkillBody).toHaveBeenCalledWith("https://cdn.example.com/SKILL.md", { expectedDigest: "a".repeat(64) });
    expect(mocks.buildBlock.mock.calls[0]![0].catalog[0].body).toBe("safe body");
  });
  it("does not activate a focused Skill when verification failed", async () => {
    mocks.loadSkillBody.mockResolvedValue(null);
    await applyAssignedSkillPrompt({ messages: [], userId: "user-1", focusedId: "skill:test" });
    expect(mocks.buildBlock.mock.calls[0]![0].focusedId).toBeNull();
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain("https://");
  });
  it("does not download unfocused Skills", async () => {
    await applyAssignedSkillPrompt({ messages: [], userId: "user-1", focusedId: null });
    expect(mocks.loadSkillBody).not.toHaveBeenCalled();
  });
});
