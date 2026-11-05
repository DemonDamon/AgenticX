import { PAT_SCOPES } from "@agenticx/core-api";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const createPatMock = vi.fn();
const listPatsMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));
vi.mock("@agenticx/iam-core", () => ({
  createPat: (...args: unknown[]) => createPatMock(...args),
  listPats: (...args: unknown[]) => listPatsMock(...args),
  isAllowedPatScope: (scope: string) => ["workspace:chat", "desktop:managed", ...PAT_SCOPES].includes(scope as never),
}));

const { POST } = await import("../route");

function post(body: unknown) {
  return new Request("http://localhost/api/admin/api-tokens", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("admin api token ma scopes", () => {
  beforeEach(() => {
    requireAdminScopeMock.mockReset();
    createPatMock.mockReset();
    listPatsMock.mockReset();
    process.env.DEFAULT_TENANT_ID = "tenant_test";
    requireAdminScopeMock.mockResolvedValue({ ok: true, session: { userId: "admin_1", tenantId: "tenant_test" }, scopes: ["*"] });
    createPatMock.mockResolvedValue({ token: "agx-pat-plain", record: { id: 1 } }); // gitleaks:allow
  });

  it("POST accepts known ma scopes", async () => {
    const scopes = ["workspace:chat", "ma:agents:write", "ma:environments:read"];
    const response = await POST(post({ name: "ci", userId: "user_1", scopes }));
    expect(response.status).toBe(200);
    expect(createPatMock).toHaveBeenCalledWith(expect.objectContaining({ scopes }));
  });

  it("POST rejects unknown ma scope", async () => {
    const response = await POST(post({ name: "ci", userId: "user_1", scopes: ["ma:foo"] }));
    expect(response.status).toBe(400);
    const body = (await response.json()) as { message?: string };
    expect(body.message).toBe("不支持的令牌权限");
    expect(createPatMock).not.toHaveBeenCalled();
  });

  it("POST rejects arbitrary non-token scopes", async () => {
    const scopes = ["workspace:chat", "custom:x"];
    const response = await POST(post({ name: "ci", userId: "user_1", scopes }));
    expect(response.status).toBe(400);
    expect(createPatMock).not.toHaveBeenCalled();
  });

  it("POST rejects non-string scopes", async () => {
    const response = await POST(post({ name: "ci", userId: "user_1", scopes: ["ma:agents:read", 1] }));
    expect(response.status).toBe(400);
    expect(createPatMock).not.toHaveBeenCalled();
  });

  it("uses authenticated tenant and actor instead of deployment defaults or JSON", async () => {
    process.env.DEFAULT_TENANT_ID = "unrelated-tenant";
    const response = await POST(post({ name: "ci", userId: "user_1", tenantId: "forged", actor: { kind: "system" } }));
    expect(response.status).toBe(200);
    expect(requireAdminScopeMock).toHaveBeenCalledWith(["user:update"]);
    expect(createPatMock).toHaveBeenCalledWith(expect.objectContaining({ tenantId: "tenant_test", actor: { kind: "user", tenantId: "tenant_test", userId: "admin_1", scopes: ["*"] } }));
  });

  it("returns forbidden for a rejected delegated grant", async () => {
    createPatMock.mockRejectedValue(Object.assign(new Error("forbidden"), { name: "PrivilegeEscalationError" }));
    expect((await POST(post({ name: "ci", userId: "owner" }))).status).toBe(403);
  });

  it("POST without scopes still calls createPat with scopes undefined", async () => {
    const response = await POST(post({ name: "ci", userId: "user_1" }));
    expect(response.status).toBe(200);
    expect(createPatMock).toHaveBeenCalledWith(expect.objectContaining({ scopes: undefined }));
  });
});
