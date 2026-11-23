import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../lib/admin-auth", () => ({
  requireAdminScope: vi.fn(async () => ({
    ok: true as const,
    session: { email: "admin@agx.io", userId: "u-admin", tenantId: "tenant-s" },
    scopes: ["provider:read", "provider:update"],
  })),
}));

vi.mock("../../../../../../lib/console-audit", () => ({
  auditConsoleEvent: vi.fn(async () => undefined),
}));

import { auditConsoleEvent } from "../../../../../../lib/console-audit";
import { GET as getScorecards, POST as postScorecards } from "../route";
import { readTenantAdmission } from "../../../../../../lib/model-admission-store";

process.env.ADMIN_MODEL_ADMISSION_FILE = `/tmp/model-admission-scorecards-test-${Date.now()}.json`;

const card = {
  schema: "agx-security-scorecard/1",
  run_id: "real-matrix-1",
  created_at: "2026-11-12T10:00:00Z",
  corpus: { version: "agx-jb-seed-1.0.0+guard-agx-guard-2.0.0" },
  models: [
    {
      provider: "zhipu",
      model: "glm-4.6",
      safety_score: 91,
      grade: "S+",
      attempts: 42,
      refused: 30,
      blocked_by_rule: 8,
      bypassed: 4,
      errors: 0,
    },
  ],
};

function jsonReq(method: string, body?: unknown): Request {
  return new Request("http://x/api/admin/security/scorecards", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(auditConsoleEvent).mockClear();
});

describe("POST /api/admin/security/scorecards", () => {
  it("导入 scorecard 并审计", async () => {
    const res = await postScorecards(jsonReq("POST", card));
    const json = await res.json();
    expect(json.imported).toBe(1);
    const admission = await readTenantAdmission("tenant-s");
    expect(admission.scorecards["glm-4.6"]!.latest.safetyScore).toBe(91);
    expect(auditConsoleEvent).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: "tenant-s" }),
      "model_admission.scorecard_imported",
      "scorecard",
      expect.objectContaining({ runId: "real-matrix-1" }),
    );
  });

  it("schema 不匹配 400", async () => {
    const res = await postScorecards(jsonReq("POST", { schema: "other", models: [] }));
    expect(res.status).toBe(400);
  });

  it("非 JSON body 400", async () => {
    const res = await postScorecards(new Request("http://x", { method: "POST" }));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/admin/security/scorecards", () => {
  it("列出导入结果", async () => {
    await postScorecards(jsonReq("POST", card));
    const res = await getScorecards(jsonReq("GET"));
    const json = await res.json();
    expect(json.scorecards["glm-4.6"]!).toBeTruthy();
    expect(json.overrides).toEqual([]);
  });
});
