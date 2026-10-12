import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeDesktopAgentActionPolicy } from "@agenticx/config";

const requireAdminScopeMock = vi.fn();
const getDesktopAgentPolicyMock = vi.fn();
const setDesktopAgentPolicyMock = vi.fn();

vi.mock("server-only", () => ({}));

vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));

vi.mock("../../../../../lib/desktop-agent-policy-store", () => ({
  getDesktopAgentPolicy: (...args: unknown[]) => getDesktopAgentPolicyMock(...args),
  setDesktopAgentPolicy: (...args: unknown[]) => setDesktopAgentPolicyMock(...args),
}));

describe("admin desktop-agent-policy route", () => {
  let stored: ReturnType<typeof normalizeDesktopAgentActionPolicy> | null = null;

  beforeEach(() => {
    stored = null;
    requireAdminScopeMock.mockReset();
    getDesktopAgentPolicyMock.mockReset();
    setDesktopAgentPolicyMock.mockReset();
    requireAdminScopeMock.mockResolvedValue({
      ok: true,
      session: { tenantId: "tenant_1", userId: "user_1", email: "admin@example.invalid" },
    });
    getDesktopAgentPolicyMock.mockImplementation(async () => ({
      ...normalizeDesktopAgentActionPolicy(stored),
      updatedAt: stored ? "2026-10-12T00:00:00.000Z" : null,
    }));
    setDesktopAgentPolicyMock.mockImplementation(async (input: unknown) => {
      stored = normalizeDesktopAgentActionPolicy(input);
      return { ...stored, updatedAt: "2026-10-12T00:00:00.000Z" };
    });
  });

  it("returns 403 when the caller lacks the required scope", async () => {
    requireAdminScopeMock.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ code: "40300", message: "forbidden" }), {
        status: 403,
        headers: { "content-type": "application/json" },
      }),
    });

    const { GET, PUT } = await import("../route");
    const getResponse = await GET();
    expect(getResponse.status).toBe(403);
    const putResponse = await PUT(
      new Request("http://localhost/api/admin/desktop-agent-policy", {
        method: "PUT",
        body: "{}",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(putResponse.status).toBe(403);
    expect(setDesktopAgentPolicyMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the PUT body is not JSON", async () => {
    const { PUT } = await import("../route");
    const response = await PUT(
      new Request("http://localhost/api/admin/desktop-agent-policy", {
        method: "PUT",
        body: "not-json",
        headers: { "content-type": "application/json" },
      }),
    );
    expect(response.status).toBe(400);
    const body = (await response.json()) as { code: string };
    expect(body.code).toBe("40001");
    expect(setDesktopAgentPolicyMock).not.toHaveBeenCalled();
  });

  it("returns the normalized policy after PUT", async () => {
    const { GET, PUT } = await import("../route");
    const putResponse = await PUT(
      new Request("http://localhost/api/admin/desktop-agent-policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          deniedTools: ["bash_exec", "bad name", "bash_exec", "git:push"],
          alwaysAskTools: ["mcp:send_*", ""],
          disableSessionAllow: "true",
        }),
      }),
    );
    expect(putResponse.status).toBe(200);
    const putBody = (await putResponse.json()) as {
      data: { policy: { deniedTools: string[]; alwaysAskTools: string[]; disableSessionAllow: boolean } };
    };
    expect(putBody.data.policy).toMatchObject({
      deniedTools: ["bash_exec", "git:push"],
      alwaysAskTools: ["mcp:send_*"],
      disableSessionAllow: false,
    });

    const getResponse = await GET();
    expect(getResponse.status).toBe(200);
    const getBody = (await getResponse.json()) as {
      data: { policy: { deniedTools: string[]; disableSessionAllow: boolean } };
    };
    expect(getBody.data.policy.deniedTools).toEqual(["bash_exec", "git:push"]);
    expect(getBody.data.policy.disableSessionAllow).toBe(false);
  });

  it("returns 500 when the store throws", async () => {
    setDesktopAgentPolicyMock.mockRejectedValue(new Error("database unavailable"));
    const { PUT } = await import("../route");
    const response = await PUT(
      new Request("http://localhost/api/admin/desktop-agent-policy", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ deniedTools: ["bash_exec"] }),
      }),
    );
    expect(response.status).toBe(500);
    const body = (await response.json()) as { code: string; message: string };
    expect(body.code).toBe("50000");
    expect(body.message).toMatch(/database unavailable/);
  });
});
