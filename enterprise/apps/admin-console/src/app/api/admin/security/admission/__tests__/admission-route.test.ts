import { beforeEach, describe, expect, it, vi } from "vitest";

// Mocks first (module paths relative to this test file's location).
vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: vi.fn(async () => ({
    ok: true as const,
    session: { email: "admin@agx.io", userId: "u-admin", tenantId: "tenant-x" },
    scopes: ["provider:read", "provider:update"],
  })),
}));

vi.mock("../../../../../../lib/console-audit", () => ({
  auditConsoleEvent: vi.fn(async () => undefined),
}));

import { auditConsoleEvent } from "../../../../../../lib/console-audit";
import { PUT as putAdmission, GET as getAdmission } from "../route";
import {
  importScorecard,
  readTenantAdmission,
  writeThreshold,
} from "../../../../../../lib/model-admission-store";

process.env.ADMIN_MODEL_ADMISSION_FILE = `/tmp/model-admission-route-test-${Date.now()}.json`;

function jsonReq(method: string, body?: unknown): Request {
  return new Request("http://x/api/admin/security/admission", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(auditConsoleEvent).mockClear();
});

describe("GET /api/admin/security/admission", () => {
  it("返回默认门槛", async () => {
    const res = await getAdmission(jsonReq("GET"));
    const json = await res.json();
    expect(json.threshold.minScore).toBe(80);
    expect(json.threshold.enabled).toBe(true);
  });
});

describe("PUT /api/admin/security/admission", () => {
  it("写入门槛并审计", async () => {
    const res = await putAdmission(
      jsonReq("PUT", { enabled: true, minScore: 90, requireScorecard: true }),
    );
    const json = await res.json();
    expect(json.threshold).toEqual({ enabled: true, minScore: 90, requireScorecard: true });
    const admission = await readTenantAdmission("tenant-x");
    expect(admission.threshold.minScore).toBe(90);
    expect(auditConsoleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-x" }),
      "model_admission.threshold_updated",
      "model_admission",
      expect.anything(),
    );
  });

  it("非法 payload 400", async () => {
    const res = await putAdmission(jsonReq("PUT", { enabled: true, minScore: 999 }));
    expect(res.status).toBe(400);
  });
});
