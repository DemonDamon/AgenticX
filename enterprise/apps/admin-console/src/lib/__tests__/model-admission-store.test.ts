import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_THRESHOLD,
  importScorecard,
  parseScorecardImport,
  readTenantAdmission,
  recordOverride,
  writeThreshold,
  type ScorecardImport,
} from "../model-admission-store";

const tmpDir = process.env.ADMISSION_TEST_TMP ?? "/tmp";
const storeFile = `${tmpDir}/model-admission-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;

process.env.ADMIN_MODEL_ADMISSION_FILE = storeFile;

function scorecard(models: Array<{ model: string; score: number }>): ScorecardImport {
  return {
    schema: "agx-security-scorecard/1",
    run_id: "run-1",
    created_at: "2026-11-12T00:00:00Z",
    corpus: { version: "seed+guard-1" },
    models: models.map((m) => ({
      provider: "zhipu",
      model: m.model,
      safety_score: m.score,
      grade: m.score >= 90 ? "S+" : m.score >= 80 ? "S" : "B",
      attempts: 42,
      refused: 10,
      blocked_by_rule: 20,
      bypassed: 12,
      errors: 0,
    })),
  };
}

beforeEach(() => {
  vi.unstubAllEnvs();
});

describe("parseScorecardImport", () => {
  it("接受合法 scorecard", () => {
    const card = parseScorecardImport(scorecard([{ model: "glm-4.6", score: 88 }]));
    expect(card.run_id).toBe("run-1");
  });

  it("拒绝 schema 不匹配", () => {
    expect(() => parseScorecardImport({ schema: "other" })).toThrow(/schema/);
  });

  it("拒绝空 models", () => {
    expect(() => parseScorecardImport({ schema: "agx-security-scorecard/1", models: [] })).toThrow(/no model/);
  });

  it("拒绝保留对象键作为 model 名（原型污染）", () => {
    for (const model of ["__proto__", "constructor", "prototype"]) {
      expect(() => parseScorecardImport(scorecard([{ model, score: 88 }]))).toThrow(/reserved/);
    }
  });
});

describe("store roundtrip", () => {
  it("默认门槛 + 写读 threshold", async () => {
    const empty = await readTenantAdmission("tenant-a");
    expect(empty.threshold).toEqual(DEFAULT_THRESHOLD);
    expect(empty.scorecards).toEqual({});

    await writeThreshold("tenant-a", { enabled: true, minScore: 75, requireScorecard: true });
    const after = await readTenantAdmission("tenant-a");
    expect(after.threshold).toEqual({ enabled: true, minScore: 75, requireScorecard: true });
  });

  it("导入 scorecard 归档 latest+history", async () => {
    await importScorecard("tenant-b", scorecard([{ model: "glm-4.6", score: 60 }]));
    await importScorecard("tenant-b", scorecard([{ model: "glm-4.6", score: 90 }]));
    const admission = await readTenantAdmission("tenant-b");
    const entry = admission.scorecards["glm-4.6"]!;
    expect(entry.latest.safetyScore).toBe(90);
    expect(entry.history).toHaveLength(1);
    expect(entry.history[0]!.safetyScore).toBe(60);
    expect(entry.latest.source).toBe("agx-security-eval");
  });

  it("override 留痕可查", async () => {
    await importScorecard("tenant-c", scorecard([{ model: "bad-model", score: 40 }]));
    await recordOverride("tenant-c", {
      model: "bad-model",
      operator: "admin@x",
      reason: "staging evaluation, business sign-off attached",
      at: "2026-11-12T01:00:00Z",
      scoreAtOverride: 40,
    });
    const admission = await readTenantAdmission("tenant-c");
    expect(admission.overrides).toHaveLength(1);
    expect(admission.overrides[0]!.reason).toContain("sign-off");
    expect(admission.overrides[0]!.scoreAtOverride).toBe(40);
  });

  it("非法导入 payload 抛错", async () => {
    await expect(importScorecard("tenant-d", { schema: "nope" } as never)).rejects.toThrow();
  });

  it("保留键 model 名在 store 边界被拒，原型不被污染", async () => {
    const before = ({} as { polluted?: boolean }).polluted;
    await expect(
      importScorecard("tenant-e", scorecard([{ model: "__proto__", score: 88 }])),
    ).rejects.toThrow(/reserved/);
    const admission = await readTenantAdmission("tenant-e");
    expect(admission.scorecards).toEqual({});
    expect(({} as { polluted?: boolean }).polluted).toBe(before);
  });
});
