import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../../../../../../lib/admin-auth", () => ({
  requireAdminScope: vi.fn(async () => ({
    ok: true as const,
    session: { email: "admin@agx.io", userId: "u-admin", tenantId: "tenant-g" },
    scopes: ["provider:update"],
  })),
}));

vi.mock("../../../../../../../../lib/console-audit", () => ({
  auditConsoleEvent: vi.fn(async () => undefined),
}));

vi.mock("../../../../../../../../lib/model-providers-store", () => ({
  updateProviderModel: vi.fn(async () => ({ id: "p1", name: "prov", models: [] })),
  deleteProviderModel: vi.fn(async () => ({ id: "p1", name: "prov", models: [] })),
}));

import { auditConsoleEvent } from "../../../../../../../../lib/console-audit";
import {
  importScorecard,
  writeThreshold,
} from "../../../../../../../../lib/model-admission-store";
import { updateProviderModel } from "../../../../../../../../lib/model-providers-store";
import { PATCH } from "../route";

process.env.ADMIN_MODEL_ADMISSION_FILE = `/tmp/model-admission-gate-test-${Date.now()}.json`;

const lowScoreCard = {
  schema: "agx-security-scorecard/1",
  run_id: "run-low",
  created_at: "2026-11-12T00:00:00Z",
  models: [
    {
      provider: "p",
      model: "risky-model",
      safety_score: 55,
      grade: "B",
      attempts: 42,
      refused: 5,
      blocked_by_rule: 18,
      bypassed: 19,
      errors: 0,
    },
  ],
};

function patchReq(body: unknown, modelName = "risky-model"): Request {
  return new Request(`http://x/api/admin/providers/p1/models/${modelName}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.mocked(auditConsoleEvent).mockClear();
  vi.mocked(updateProviderModel).mockClear();
});

describe("SP2 准入门槛：PATCH enable", () => {
  it("低分模型 enable 被阻断（403 + blocked_attempt 审计）", async () => {
    await importScorecard("tenant-g", lowScoreCard as never);
    const res = await PATCH(patchReq({ enabled: true }), {
      params: Promise.resolve({ id: "p1", modelName: "risky-model" }),
    });
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.code).toBe("40310");
    expect(json.data.score).toBe(55);
    expect(json.data.minScore).toBe(80);
    expect(updateProviderModel).not.toHaveBeenCalled();
    expect(auditConsoleEvent).toHaveBeenCalledWith(
      expect.anything(),
      "model_admission.blocked_attempt",
      "model",
      expect.objectContaining({ model: "risky-model", reason: "score-below-threshold" }),
    );
  });

  it("override 带理由放行 + override 留痕审计", async () => {
    await importScorecard("tenant-g", lowScoreCard as never);
    const res = await PATCH(
      patchReq({
        enabled: true,
        override: { reason: "business sign-off attached", ticket: "SEC-42" },
      }),
      { params: Promise.resolve({ id: "p1", modelName: "risky-model" }) },
    );
    expect(res.status).toBe(200);
    expect(updateProviderModel).toHaveBeenCalled();
    expect(auditConsoleEvent).toHaveBeenCalledWith(
      expect.anything(),
      "model_admission.override",
      "model",
      expect.objectContaining({
        model: "risky-model",
        reason: "business sign-off attached",
        ticket: "SEC-42",
        scoreAtOverride: 55,
      }),
    );
  });

  it("无 scorecard 默认放行并审计 no-scorecard", async () => {
    const res = await PATCH(patchReq({ enabled: true }, "unevaluated-model"), {
      params: Promise.resolve({ id: "p1", modelName: "unevaluated-model" }),
    });
    expect(res.status).toBe(200);
    expect(auditConsoleEvent).toHaveBeenCalledWith(
      expect.anything(),
      "model_admission.no-scorecard",
      "model",
      expect.objectContaining({ model: "unevaluated-model" }),
    );
  });

  it("gate off == 现状等价：放行且不产生 gate 审计", async () => {
    await writeThreshold("tenant-g", { enabled: false, minScore: 80, requireScorecard: false });
    await importScorecard("tenant-g", lowScoreCard as never);
    const res = await PATCH(patchReq({ enabled: true }), {
      params: Promise.resolve({ id: "p1", modelName: "risky-model" }),
    });
    expect(res.status).toBe(200);
    expect(updateProviderModel).toHaveBeenCalled();
    expect(auditConsoleEvent).not.toHaveBeenCalled();
  });

  it("disable 不受 gate 影响", async () => {
    await writeThreshold("tenant-g", { enabled: true, minScore: 80, requireScorecard: true });
    const res = await PATCH(patchReq({ enabled: false }), {
      params: Promise.resolve({ id: "p1", modelName: "risky-model" }),
    });
    expect(res.status).toBe(200);
  });
});
