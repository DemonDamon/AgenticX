import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveDesktopIdentity = vi.fn();
const loadUserCapabilityView = vi.fn();
const setUserCapabilityPreference = vi.fn();

vi.mock("../../../../../lib/desktop-auth", () => ({
  resolveDesktopIdentity: (...args: unknown[]) => resolveDesktopIdentity(...args),
}));

vi.mock("../../../../../lib/capability-packs-reader", async () => {
  const actual = await vi.importActual<Record<string, unknown>>(
    "../../../../../lib/capability-packs-reader",
  );
  return {
    ...actual,
    loadUserCapabilityView: (...args: unknown[]) => loadUserCapabilityView(...args),
  };
});

vi.mock("../../../../../lib/capability-opt-outs-store", () => ({
  setUserCapabilityPreference: (...args: unknown[]) => setUserCapabilityPreference(...args),
}));

const MCP_ID = "mcp:01JQMZ8K3N4P5Q6R7S8T9VWXYZ";
const SKILL_ID = "skill:01JQMZ8K3N4P5Q6R7S8T9VWXY0";

function identity() {
  return {
    userId: "u1",
    tenantId: "t1",
    deptId: "d1",
    email: "a@example.invalid",
    displayName: "A",
    tokenId: 1,
    scopes: ["workspace:chat", "desktop:managed"],
  };
}

function request(body?: unknown): Request {
  return new Request("http://localhost:3000/api/desktop/capabilities", {
    method: body === undefined ? "GET" : "PATCH",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

describe("/api/desktop/capabilities", () => {
  beforeEach(() => {
    resolveDesktopIdentity.mockReset();
    loadUserCapabilityView.mockReset();
    setUserCapabilityPreference.mockReset();
    resolveDesktopIdentity.mockResolvedValue(identity());
  });

  it("lists capabilities the user turned off, so they can be turned back on", async () => {
    loadUserCapabilityView.mockResolvedValue({
      assigned: [
        { id: MCP_ID, kind: "mcp", name: "m", displayName: "M", requires: [] },
        { id: SKILL_ID, kind: "skill", name: "s", displayName: "S", requires: [] },
      ],
      optOuts: new Set([SKILL_ID]),
    });
    const { GET } = await import("../route");
    const res = await GET(request());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.capabilities).toEqual([
      { id: MCP_ID, kind: "mcp", name: "m", displayName: "M", requires: [], state: "on" },
      { id: SKILL_ID, kind: "skill", name: "s", displayName: "S", requires: [], state: "off" },
    ]);
  });

  it("rejects enabling a capability the enterprise has not granted", async () => {
    setUserCapabilityPreference.mockResolvedValue({ ok: false, reason: "enterprise_disabled" });
    const { PATCH } = await import("../route");
    const res = await PATCH(request({ capabilityId: MCP_ID, enabled: true }));
    expect(res.status).toBe(403);
  });

  it("requires enabled to be a boolean rather than coercing it", async () => {
    const { PATCH } = await import("../route");
    const res = await PATCH(request({ capabilityId: MCP_ID, enabled: "true" }));
    expect(res.status).toBe(400);
    expect(setUserCapabilityPreference).not.toHaveBeenCalled();
  });

  it("returns 401 without a valid desktop token", async () => {
    resolveDesktopIdentity.mockResolvedValue(null);
    const { GET } = await import("../route");
    expect((await GET(request())).status).toBe(401);
  });
});
