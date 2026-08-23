import { describe, expect, it, vi } from "vitest";
import {
  applyEnterpriseCapabilitiesToDisk,
  hasEnterprisePat,
} from "../electron/enterprise-capabilities-sync";

describe("hasEnterprisePat", () => {
  it("is false when the employee has not signed in", () => {
    expect(hasEnterprisePat({})).toBe(false);
    expect(hasEnterprisePat({ enterprise: { enabled: true, token: "" } })).toBe(false);
  });

  it("is true only with an enabled account and a token", () => {
    expect(hasEnterprisePat({ enterprise: { enabled: true, token: "agx-pat-x" } })).toBe(true);
  });
});

describe("applyEnterpriseCapabilitiesToDisk", () => {
  it("does not touch local MCP or skills when there is no enterprise token", async () => {
    const readMcpDocument = vi.fn();
    const writeMcpDocument = vi.fn();
    const fetchSkillBundle = vi.fn();
    const writeSkill = vi.fn();
    const removeSkill = vi.fn();

    const result = await applyEnterpriseCapabilitiesToDisk({
      cfg: { enterprise: { managed_mcp_servers: ["keep"], managed_skills: ["keep"] } },
      token: "",
      capabilities: [{ id: "mcp:01JQMZ8K3N4P5Q6R7S8T9VWXYZ", kind: "mcp", name: "x" }],
      readMcpDocument,
      writeMcpDocument,
      fetchSkillBundle,
      writeSkill,
      removeSkill,
    });

    expect(result.skipped).toBe(true);
    expect(result.managedMcp).toEqual(["keep"]);
    expect(readMcpDocument).not.toHaveBeenCalled();
    expect(writeMcpDocument).not.toHaveBeenCalled();
    expect(writeSkill).not.toHaveBeenCalled();
    expect(removeSkill).not.toHaveBeenCalled();
  });
});
