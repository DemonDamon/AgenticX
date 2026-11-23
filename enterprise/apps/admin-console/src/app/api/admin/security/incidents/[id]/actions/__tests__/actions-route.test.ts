import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../../../lib/admin-auth", () => ({
  requireAdminScope: vi.fn(async () => ({
    ok: true as const,
    session: { email: "admin@agx.io", userId: "u-admin", tenantId: "tenant-s" },
    scopes: ["provider:update"],
  })),
}));

const { executeIncidentActionMock, IncidentActionErrorMock } = vi.hoisted(() => {
  class IncidentActionError extends Error {
    constructor(
      message: string,
      readonly statusCode: number,
    ) {
      super(message);
    }
  }
  return {
    executeIncidentActionMock: vi.fn(),
    IncidentActionErrorMock: IncidentActionError,
  };
});

vi.mock("../../../../../../../../lib/incident-response", () => ({
  executeIncidentAction: executeIncidentActionMock,
  IncidentActionError: IncidentActionErrorMock,
}));

vi.mock("@agenticx/iam-core", () => ({
  getSecurityIncident: vi.fn(async () => ({
    id: "inc-1",
    tenantId: "tenant-s",
    title: "PII 外泄",
    status: "open",
    severity: "critical",
    source: "policy_hit",
  })),
  updateSecurityIncidentStatus: vi.fn(async () => ({ id: "inc-1", status: "handling" })),
}));

vi.mock("../../../../../../../../lib/model-providers-store", () => ({
  updateProviderModel: vi.fn(async () => undefined),
}));

import { getSecurityIncident, updateSecurityIncidentStatus } from "@agenticx/iam-core";
import { POST } from "../route";

function jsonReq(body: unknown): Request {
  return new Request("http://x/api/admin/security/incidents/inc-1/actions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function ctx() {
  return { params: Promise.resolve({ id: "inc-1" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/admin/security/incidents/[id]/actions", () => {
  it("非法 action 400", async () => {
    const res = await POST(jsonReq({ action: "nuke", targetId: "x" }), ctx());
    expect(res.status).toBe(400);
  });

  it("缺 targetId 400", async () => {
    const res = await POST(jsonReq({ action: "revoke_pat" }), ctx());
    expect(res.status).toBe(400);
  });

  it("事件不存在 404", async () => {
    vi.mocked(getSecurityIncident).mockResolvedValueOnce(null);
    const res = await POST(jsonReq({ action: "revoke_pat", targetId: "42" }), ctx());
    expect(res.status).toBe(404);
  });

  it("合法处置：open 事件自动流转 handling", async () => {
    executeIncidentActionMock.mockResolvedValueOnce({ id: "act-1", outcome: "done" });
    const res = await POST(jsonReq({ action: "revoke_pat", targetId: "42" }), ctx());
    expect(res.status).toBe(200);
    expect(executeIncidentActionMock).toHaveBeenCalledTimes(1);
    const input = executeIncidentActionMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(input).toMatchObject({
      tenantId: "tenant-s",
      incidentId: "inc-1",
      action: "revoke_pat",
      targetId: "42",
    });
    expect(updateSecurityIncidentStatus).toHaveBeenCalledWith({
      tenantId: "tenant-s",
      incidentId: "inc-1",
      status: "handling",
    });
  });

  it("IncidentActionError 映射状态码（二次确认缺失 400）", async () => {
    executeIncidentActionMock.mockImplementationOnce(async () => {
      throw new IncidentActionErrorMock("disable_user requires confirm=true (二次确认)", 400);
    });
    const res = await POST(jsonReq({ action: "disable_user", targetId: "user-9" }), ctx());
    expect(res.status).toBe(400);
    const json = (await res.json()) as { message: string };
    expect(json.message).toContain("confirm");
    // 二次确认失败不改变事件状态
    expect(updateSecurityIncidentStatus).not.toHaveBeenCalled();
  });

  it("block_model 走注入的 provider executor", async () => {
    executeIncidentActionMock.mockResolvedValueOnce({ id: "act-2", outcome: "done" });
    const res = await POST(
      jsonReq({ action: "block_model", targetId: "prov-x/glm-5.3" }),
      ctx(),
    );
    expect(res.status).toBe(200);
    const deps = executeIncidentActionMock.mock.calls[0]![1] as {
      blockModel: (t: string, m: string) => Promise<void>;
    };
    expect(typeof deps.blockModel).toBe("function");
  });
});
