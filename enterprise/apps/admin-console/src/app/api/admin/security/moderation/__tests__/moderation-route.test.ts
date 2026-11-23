import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: vi.fn(async () => ({
    ok: true as const,
    session: { email: "admin@agx.io", userId: "u-admin", tenantId: "tenant-s" },
    scopes: ["audit:read", "audit:manage"],
  })),
}));

vi.mock("../../../../../../lib/console-audit", () => ({
  auditConsoleEvent: vi.fn(async () => undefined),
}));

import { auditConsoleEvent } from "../../../../../../lib/console-audit";
import { GET, PUT, DELETE } from "../route";
import { readModerationConfig } from "../../../../../../lib/moderation-store";

process.env.GATEWAY_ADMIN_MODERATION_FILE = `/tmp/moderation-route-test-${Date.now()}.json`;

const validConfig = {
  enabled: true,
  mode: "degraded" as const,
  blockSeverity: "critical" as const,
  timeoutSeconds: 3,
  categories: ["politics", "porn"],
  provider: { type: "http" as const, name: "vendor-x", url: "https://cs.example.com/check", apiKey: "sk-secret" },
};

function jsonReq(method: string, url: string, body?: unknown): Request {
  return new Request(`http://x${url}`, {
    method,
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(auditConsoleEvent).mockClear();
});

describe("PUT /api/admin/security/moderation", () => {
  it("保存租户配置并审计留痕（apiKey 不入审计）", async () => {
    const res = await PUT(
      jsonReq("PUT", "/api/admin/security/moderation", { tenantId: "tenant-1", config: validConfig }),
    );
    expect(res.status).toBe(200);
    const stored = await readModerationConfig();
    expect(stored.tenants["tenant-1"]?.provider.url).toBe("https://cs.example.com/check");
    expect(stored.tenants["tenant-1"]?.mode).toBe("degraded");
    expect(auditConsoleEvent).toHaveBeenCalledTimes(1);
    const detail = vi.mocked(auditConsoleEvent).mock.calls[0]![3] as Record<string, unknown>;
    expect(detail).not.toHaveProperty("apiKey");
    expect(detail.hasApiKey).toBe(true);
  });

  it("掩码 apiKey 原样带回时保留旧值", async () => {
    await PUT(
      jsonReq("PUT", "/api/admin/security/moderation", { tenantId: "tenant-1", config: validConfig }),
    );
    const masked = JSON.parse(JSON.stringify(validConfig)) as typeof validConfig;
    masked.provider.apiKey = "******";
    await PUT(
      jsonReq("PUT", "/api/admin/security/moderation", { tenantId: "tenant-1", config: masked }),
    );
    const stored = await readModerationConfig();
    expect(stored.tenants["tenant-1"]?.provider.apiKey).toBe("sk-secret");
  });

  it("非法 mode 400", async () => {
    const bad = { ...validConfig, mode: "yolo" } as unknown as typeof validConfig;
    const res = await PUT(
      jsonReq("PUT", "/api/admin/security/moderation", { tenantId: "tenant-1", config: bad }),
    );
    expect(res.status).toBe(400);
  });

  it("enabled 但缺 provider url 400", async () => {
    const bad = {
      ...validConfig,
      provider: { ...validConfig.provider, url: " " },
    } as typeof validConfig;
    const res = await PUT(
      jsonReq("PUT", "/api/admin/security/moderation", { tenantId: "tenant-1", config: bad }),
    );
    expect(res.status).toBe(400);
  });

  it("缺 tenantId 400", async () => {
    const res = await PUT(
      jsonReq("PUT", "/api/admin/security/moderation", { config: validConfig }),
    );
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/security/moderation", () => {
  it("单租户查询 apiKey 掩码", async () => {
    await PUT(
      jsonReq("PUT", "/api/admin/security/moderation", { tenantId: "tenant-1", config: validConfig }),
    );
    const res = await GET(jsonReq("GET", "/api/admin/security/moderation?tenant=tenant-1"));
    const json = (await res.json()) as { data: typeof validConfig | null };
    expect(json.data?.provider.apiKey).toBe("******");
  });

  it("全量查询同样掩码", async () => {
    const res = await GET(jsonReq("GET", "/api/admin/security/moderation"));
    const json = (await res.json()) as {
      data: { tenants: Record<string, typeof validConfig> };
    };
    expect(json.data.tenants["tenant-1"]?.provider.apiKey).toBe("******");
  });

  it("未配置租户返回 null", async () => {
    const res = await GET(jsonReq("GET", "/api/admin/security/moderation?tenant=none"));
    const json = (await res.json()) as { data: unknown };
    expect(json.data).toBeNull();
  });
});

describe("DELETE /api/admin/security/moderation", () => {
  it("删除后回到现状等价并审计", async () => {
    await PUT(
      jsonReq("PUT", "/api/admin/security/moderation", { tenantId: "tenant-1", config: validConfig }),
    );
    const res = await DELETE(jsonReq("DELETE", "/api/admin/security/moderation?tenant=tenant-1"));
    expect(res.status).toBe(200);
    const stored = await readModerationConfig();
    expect(stored.tenants["tenant-1"]).toBeUndefined();
    expect(auditConsoleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ email: "admin@agx.io" }),
      "moderation.config_deleted",
      "moderation",
      expect.objectContaining({ tenantId: "tenant-1" }),
    );
  });

  it("缺 tenant 参数 400", async () => {
    const res = await DELETE(jsonReq("DELETE", "/api/admin/security/moderation"));
    expect(res.status).toBe(400);
  });
});
