import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyPatMock = vi.fn();
const touchPatLastUsedMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("@agenticx/iam-core", () => ({
  verifyPat: (...args: unknown[]) => verifyPatMock(...args),
  touchPatLastUsed: (...args: unknown[]) => touchPatLastUsedMock(...args),
}));

const { patHasMaScope, requireMaPat } = await import("../pat-auth");

function request(token?: string): Request {
  const headers = token ? { authorization: `Bearer ${token}` } : undefined;
  return new Request("http://localhost/api/ma/v1/agents", { headers });
}

describe("ma pat auth", () => {
  beforeEach(() => {
    verifyPatMock.mockReset();
    touchPatLastUsedMock.mockReset();
    touchPatLastUsedMock.mockResolvedValue(undefined);
  });

  it("returns 401 without Authorization header", async () => {
    const result = await requireMaPat(request(), "ma:agents:read");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    const body = (await result.response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("returns 401 when verifyPat returns null", async () => {
    verifyPatMock.mockResolvedValue(null);
    const result = await requireMaPat(request("agx-pat-missing"), "ma:agents:read");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(401);
    const body = (await result.response.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unauthorized");
  });

  it("returns 403 forbidden_scope when scope missing", async () => {
    verifyPatMock.mockResolvedValue({
      id: 3,
      tenantId: "t",
      userId: "u",
      deptId: null,
      scopes: ["ma:agents:read"],
      status: "active",
    });
    const result = await requireMaPat(request("agx-pat-ok"), "ma:agents:write");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.response.status).toBe(403);
    const body = (await result.response.json()) as { error: { code: string; details?: { required?: string } } };
    expect(body.error.code).toBe("forbidden_scope");
    expect(body.error.details?.required).toBe("ma:agents:write");
  });

  it("ma:admin satisfies any ma scope", async () => {
    verifyPatMock.mockResolvedValue({
      id: 3,
      tenantId: "t",
      userId: "u",
      deptId: null,
      scopes: ["ma:admin"],
      status: "active",
    });
    const result = await requireMaPat(request("agx-pat-admin"), "ma:environments:write");
    expect(result.ok).toBe(true);
  });

  it("patHasMaScope ignores role registry", () => {
    expect(patHasMaScope(["ma:agents:read"], "ma:agents:read")).toBe(true);
  });

  it("touches last used on success", async () => {
    verifyPatMock.mockResolvedValue({
      id: 9,
      tenantId: "t",
      userId: "u",
      deptId: "d",
      scopes: ["ma:agents:read"],
      status: "active",
    });
    const result = await requireMaPat(request("agx-pat-ok"), "ma:agents:read");
    expect(result.ok).toBe(true);
    expect(touchPatLastUsedMock).toHaveBeenCalledWith(9);
  });
});
