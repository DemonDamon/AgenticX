import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdminScopeMock = vi.fn();
const readAlertChannelsMock = vi.fn();
const readTenantAlertChannelsMock = vi.fn();
const writeTenantAlertChannelsMock = vi.fn();
const deleteTenantAlertChannelsMock = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: (...args: unknown[]) => requireAdminScopeMock(...args),
}));
vi.mock("../../../../../../lib/alert-channels-store", () => ({
  readAlertChannels: (...args: unknown[]) => readAlertChannelsMock(...args),
  readTenantAlertChannels: (...args: unknown[]) => readTenantAlertChannelsMock(...args),
  writeTenantAlertChannels: (...args: unknown[]) => writeTenantAlertChannelsMock(...args),
  deleteTenantAlertChannels: (...args: unknown[]) => deleteTenantAlertChannelsMock(...args),
}));

const { GET, PUT, DELETE } = await import("../route");

function allow(scopes: string[]) {
  requireAdminScopeMock.mockResolvedValue({ ok: true, response: undefined });
  void scopes;
}

function deny() {
  requireAdminScopeMock.mockResolvedValue({
    ok: false,
    response: Response.json({ code: "40300", message: "forbidden" }, { status: 403 }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  requireAdminScopeMock.mockResolvedValue({ ok: true, response: undefined });
});

describe("GET /api/admin/alerts/channels", () => {
  it("无 audit:read 权限时拒绝", async () => {
    deny();
    const res = await GET(new Request("http://x/api/admin/alerts/channels"));
    expect(res.status).toBe(403);
  });

  it("带 tenant 参数返回单租户配置", async () => {
    allow(["audit:read"]);
    readTenantAlertChannelsMock.mockResolvedValue({
      channels: [{ type: "feishu", url: "https://open.feishu.cn/hook/x", minSeverity: "CRITICAL" }],
    });
    const res = await GET(new Request("http://x/api/admin/alerts/channels?tenant=t1"));
    const json = await res.json();
    expect(json.code).toBe("00000");
    expect(readTenantAlertChannelsMock).toHaveBeenCalledWith("t1");
    expect(json.data.channels[0].type).toBe("feishu");
  });

  it("不带参数返回全量配置", async () => {
    readAlertChannelsMock.mockResolvedValue({ tenants: {} });
    const res = await GET(new Request("http://x/api/admin/alerts/channels"));
    const json = await res.json();
    expect(json.code).toBe("00000");
    expect(readAlertChannelsMock).toHaveBeenCalled();
  });
});

describe("PUT /api/admin/alerts/channels", () => {
  it("写入租户通道配置", async () => {
    writeTenantAlertChannelsMock.mockResolvedValue(undefined);
    const config = {
      channels: [{ type: "webhook", url: "https://ops.example.com/hook", minSeverity: "HIGH" }],
      dedupWindowSeconds: 600,
      rateLimitPerMinute: 10,
    };
    const res = await PUT(
      new Request("http://x/api/admin/alerts/channels", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId: "t1", config }),
      }),
    );
    const json = await res.json();
    expect(json.code).toBe("00000");
    expect(writeTenantAlertChannelsMock).toHaveBeenCalledWith("t1", config);
  });

  it("缺 tenantId 时 400", async () => {
    const res = await PUT(
      new Request("http://x/api/admin/alerts/channels", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ config: { channels: [] } }),
      }),
    );
    expect(res.status).toBe(400);
  });

  it("非法通道类型经 store 校验拒绝", async () => {
    writeTenantAlertChannelsMock.mockRejectedValue(new Error("unsupported channel type: sms"));
    const res = await PUT(
      new Request("http://x/api/admin/alerts/channels", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tenantId: "t1",
          config: { channels: [{ type: "sms", url: "x" }] },
        }),
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.message).toContain("unsupported channel type");
  });
});

describe("DELETE /api/admin/alerts/channels", () => {
  it("删除租户配置", async () => {
    deleteTenantAlertChannelsMock.mockResolvedValue(undefined);
    const res = await DELETE(new Request("http://x/api/admin/alerts/channels?tenant=t1"));
    const json = await res.json();
    expect(json.code).toBe("00000");
    expect(deleteTenantAlertChannelsMock).toHaveBeenCalledWith("t1");
  });

  it("缺 tenant 参数时 400", async () => {
    const res = await DELETE(new Request("http://x/api/admin/alerts/channels"));
    expect(res.status).toBe(400);
  });
});
