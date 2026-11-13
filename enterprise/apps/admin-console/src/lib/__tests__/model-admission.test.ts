import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  decideAdmission,
  isBlocked,
  makeOverride,
  validateOverrideInput,
} from "../model-admission";
import { DEFAULT_THRESHOLD, type TenantAdmission } from "../model-admission-store";

function tenant(partial: Partial<TenantAdmission> = {}): TenantAdmission {
  return {
    threshold: { ...DEFAULT_THRESHOLD },
    scorecards: {},
    overrides: [],
    ...partial,
  };
}

const lowScore = {
  latest: {
    model: "risky-model",
    provider: "p",
    runId: "run-1",
    createdAt: "2026-11-12T00:00:00Z",
    corpusVersion: "v1",
    safetyScore: 55,
    grade: "B",
    attempts: 42,
    refused: 5,
    blockedByRule: 18,
    bypassed: 19,
    errors: 0,
    source: "agx-security-eval" as const,
  },
  history: [],
};

describe("decideAdmission（准入判定纯函数）", () => {
  it("gate off == 现状等价（放行）", () => {
    const t = tenant({ threshold: { enabled: false, minScore: 80, requireScorecard: true } });
    const action = decideAdmission(t, "any-model");
    expect(action.kind).toBe("allow");
    expect(action.reason).toBe("gate-off");
    expect(isBlocked(action)).toBe(false);
  });

  it("低于阈值 → 阻断", () => {
    const t = tenant({ scorecards: { "risky-model": lowScore } });
    const action = decideAdmission(t, "risky-model");
    expect(isBlocked(action)).toBe(true);
    if (isBlocked(action)) {
      expect(action.reason).toBe("score-below-threshold");
      expect(action.score).toBe(55);
      expect(action.minScore).toBe(80);
    }
  });

  it("达标 → 放行 score-passed", () => {
    const t = tenant({
      scorecards: {
        "good-model": { ...lowScore, latest: { ...lowScore.latest, model: "good-model", safetyScore: 95, grade: "S+" } },
      },
    });
    const action = decideAdmission(t, "good-model");
    expect(action.kind).toBe("allow");
    expect(action.reason).toBe("score-passed");
  });

  it("无 scorecard 默认放行；requireScorecard 时阻断", () => {
    expect(decideAdmission(tenant(), "unknown").reason).toBe("no-scorecard");
    const strict = tenant({ threshold: { enabled: true, minScore: 80, requireScorecard: true } });
    expect(decideAdmission(strict, "unknown").reason).toBe("scorecard-required");
  });

  it("边界：分数恰等于阈值放行", () => {
    const t = tenant({
      scorecards: {
        m: { ...lowScore, latest: { ...lowScore.latest, model: "m", safetyScore: 80, grade: "S" } },
      },
    });
    expect(decideAdmission(t, "m").reason).toBe("score-passed");
  });
});

describe("override 校验与留痕构造", () => {
  it("reason 至少 5 字符", () => {
    expect(() => validateOverrideInput({ reason: "ok" })).toThrow();
    expect(validateOverrideInput({ reason: "business approved" }).reason).toBe("business approved");
  });

  it("ticket 可选保留", () => {
    expect(validateOverrideInput({ reason: "signed-off by CISO", ticket: "SEC-12" }).ticket).toBe("SEC-12");
    expect(validateOverrideInput({ reason: "signed-off by CISO" }).ticket).toBeUndefined();
  });

  it("makeOverride 记录操作者与当时分数", () => {
    const t = tenant({ scorecards: { "risky-model": lowScore } });
    const o = makeOverride(t, "risky-model", "u1", { reason: "staging exception approved" });
    expect(o.model).toBe("risky-model");
    expect(o.operator).toBe("u1");
    expect(o.scoreAtOverride).toBe(55);
    expect(o.at).toBeTruthy();
  });
});
