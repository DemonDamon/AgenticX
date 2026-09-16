import { describe, expect, it } from "vitest";
import {
  buildEnterpriseMcpEntry,
  enterpriseMcpEntryName,
  isAcceptableBundleUri,
  normalizeEnterpriseCapabilities,
  planEnterpriseSkills,
  removeEnterpriseMcpDocument,
  syncEnterpriseMcpDocument,
  type EnterpriseCapability,
} from "../electron/enterprise-capabilities";

const MCP_ID = "mcp:01JQMZ8K3N4P5Q6R7S8T9VWXYZ";
const SKILL_ID = "skill:01JQMZ8K3N4P5Q6R7S8T9VWXY0";

function mcp(overrides: Partial<EnterpriseCapability> = {}): EnterpriseCapability {
  return {
    id: MCP_ID,
    kind: "mcp",
    name: "market-data",
    displayName: "行情数据",
    requires: [],
    endpointUrl: "https://gw.example.invalid/v1/mcp/01JQMZ8K3N4P5Q6R7S8T9VWXYZ/",
    ...overrides,
  };
}

function skill(overrides: Partial<EnterpriseCapability> = {}): EnterpriseCapability {
  return {
    id: SKILL_ID,
    kind: "skill",
    name: "research",
    displayName: "研究",
    requires: [],
    bundleUri: "https://portal.example.invalid/skills/research/SKILL.md",
    bundleDigest: "ABCD",
    ...overrides,
  };
}

describe("normalizeEnterpriseCapabilities", () => {
  it("drops entries with an unknown kind rather than passing them through", () => {
    expect(normalizeEnterpriseCapabilities([{ id: "x:1", kind: "plugin", name: "n" }])).toEqual([]);
  });

  it("dedupes by capability id", () => {
    expect(normalizeEnterpriseCapabilities([mcp(), mcp({ displayName: "另一个" })])).toHaveLength(1);
  });

  it("survives a config written by an older desktop that had no capabilities", () => {
    expect(normalizeEnterpriseCapabilities(undefined)).toEqual([]);
  });
});

describe("syncEnterpriseMcpDocument", () => {
  const token = "agx-pat-test";

  it("registers a delivered MCP under the enterprise prefix", () => {
    const result = syncEnterpriseMcpDocument({}, [mcp()], token, []);
    expect(result.managedNames).toEqual(["enterprise-market-data"]);
    expect(result.document.mcpServers).toEqual({
      "enterprise-market-data": buildEnterpriseMcpEntry(mcp(), token),
    });
  });

  it("removes an entry it wrote once the capability stops being delivered", () => {
    // 后台撤销后，能力就不在下发列表里；本地留着等于撤销没生效。
    const result = syncEnterpriseMcpDocument(
      { mcpServers: { "enterprise-market-data": { url: "x" } } },
      [],
      token,
      ["enterprise-market-data"],
    );
    expect(result.document.mcpServers).toEqual({});
    expect(result.managedNames).toEqual([]);
  });

  it("never touches an entry the employee configured themselves", () => {
    const mine = { command: "node", args: ["server.js"] };
    const result = syncEnterpriseMcpDocument({ mcpServers: { mine } }, [mcp()], token, [
      "enterprise-gone",
    ]);
    expect((result.document.mcpServers as Record<string, unknown>).mine).toEqual(mine);
  });

  it("reports a conflict instead of overwriting a same-named entry it did not write", () => {
    const theirs = { url: "https://mine.example.invalid/" };
    const result = syncEnterpriseMcpDocument(
      { mcpServers: { "enterprise-market-data": theirs } },
      [mcp()],
      token,
      [],
    );
    expect(result.conflicts).toEqual(["enterprise-market-data"]);
    expect((result.document.mcpServers as Record<string, unknown>)["enterprise-market-data"]).toEqual(
      theirs,
    );
  });

  it("skips a capability with no gateway endpoint rather than writing a dead server", () => {
    const result = syncEnterpriseMcpDocument({}, [mcp({ endpointUrl: undefined })], token, []);
    expect(result.managedNames).toEqual([]);
  });

  it("sanitizes names into a safe tool prefix", () => {
    expect(enterpriseMcpEntryName(mcp({ name: "行情 Data/v2" }))).toBe("enterprise-data-v2");
  });
});

describe("removeEnterpriseMcpDocument", () => {
  it("withdraws only what it wrote on logout", () => {
    const doc = {
      mcpServers: { "enterprise-market-data": { url: "x" }, mine: { command: "node" } },
    };
    expect(removeEnterpriseMcpDocument(doc, ["enterprise-market-data"]).mcpServers).toEqual({
      mine: { command: "node" },
    });
  });
});

describe("planEnterpriseSkills", () => {
  it("refuses a bundle without a digest, since it cannot be verified", () => {
    const plan = planEnterpriseSkills([skill({ bundleDigest: "" })], []);
    expect(plan.install).toEqual([]);
    expect(plan.skipped[0]?.reason).toBe("no-digest");
  });

  it("refuses a plain-http bundle from a non-loopback host", () => {
    const plan = planEnterpriseSkills([skill({ bundleUri: "http://cdn.example.invalid/s.md" })], []);
    expect(plan.skipped[0]?.reason).toBe("insecure-uri");
  });

  it("allows http on loopback so local development still works", () => {
    expect(isAcceptableBundleUri("http://127.0.0.1:3001/skills/a.md")).toBe(true);
  });

  it("lowercases the digest so a hex-case difference is not read as tampering", () => {
    expect(planEnterpriseSkills([skill()], []).install[0]?.bundleDigest).toBe("abcd");
  });

  it("removes a skill directory it installed once the skill stops being delivered", () => {
    expect(planEnterpriseSkills([], ["research"]).remove).toEqual(["research"]);
  });
});
