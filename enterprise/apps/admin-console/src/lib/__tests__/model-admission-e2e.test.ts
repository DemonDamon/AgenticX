import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

// E2E (SP2 acceptance): the REAL scorecard produced by
// `agx security-eval run` (reports/security-eval/real-matrix-1) flows
// through import -> admission decision. Both evaluated real models
// (MiniMax-M2.7: 76, glm-5.3-flash: 69) score below the default
// threshold (80) and must be blocked; the override path must leave a
// record.

import { decideAdmission, isBlocked, makeOverride, validateOverrideInput } from "../model-admission";
import {
  importScorecard,
  parseScorecardImport,
  readTenantAdmission,
  recordOverride,
} from "../model-admission-store";

const realCardPath = path.resolve(
  process.cwd(),
  "../../../reports/security-eval/real-matrix-1/scorecard.json",
);

describe("E2E: real security-eval scorecard drives admission", () => {
  it("真实记分卡导入并阻断低于阈值的双模型", async () => {
    process.env.ADMIN_MODEL_ADMISSION_FILE = `/tmp/admission-e2e-real-${Date.now()}.json`;
    const raw = JSON.parse(await readFile(realCardPath, "utf-8"));
    const card = parseScorecardImport(raw);
    expect(card.models.length).toBeGreaterThanOrEqual(2);

    const tenantId = "tenant-e2e";
    await importScorecard(tenantId, card);
    const admission = await readTenantAdmission(tenantId);

    for (const m of card.models) {
      const action = decideAdmission(admission, m.model);
      expect(isBlocked(action)).toBe(true);
      if (isBlocked(action)) {
        expect(action.reason).toBe("score-below-threshold");
        expect(action.score).toBe(m.safety_score);
        expect(action.score).toBeLessThan(admission.threshold.minScore);
      }
    }
  });

  it("override 留痕：低分模型例外启用被完整记录", async () => {
    process.env.ADMIN_MODEL_ADMISSION_FILE = `/tmp/admission-e2e-override-${Date.now()}.json`;
    const raw = JSON.parse(await readFile(realCardPath, "utf-8"));
    const card = parseScorecardImport(raw);
    const tenantId = "tenant-e2e-ov";
    await importScorecard(tenantId, card);
    const admission = await readTenantAdmission(tenantId);

    const target = card.models[0];
    const override = makeOverride(
      admission,
      target.model,
      "admin@agx.io",
      validateOverrideInput({ reason: "presale demo exception, CISO sign-off attached", ticket: "SEC-42" }),
    );
    await recordOverride(tenantId, override);
    const after = await readTenantAdmission(tenantId);
    expect(after.overrides).toHaveLength(1);
    expect(after.overrides[0]!.model).toBe(target.model);
    expect(after.overrides[0]!.scoreAtOverride).toBe(target.safety_score);
    expect(after.overrides[0]!.ticket).toBe("SEC-42");
  });
});
