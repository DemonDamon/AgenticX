import { describe, expect, it } from "vitest";

import { compareEvalRuns, EvalCompareMismatchError } from "../eval-compare";
import type { EvalResultView, EvalRunView } from "../eval-records";

function run(id: string, version: number, summary: EvalRunView["summary"]): EvalRunView {
  return {
    id,
    tenant_id: "T",
    kind: "eval",
    status: "completed",
    agent_id: "A",
    agent_version: version,
    environment_id: null,
    dataset_id: "D",
    dataset_name: "集",
    dataset_hash: "sha256:same",
    rubric_id: "R",
    rubric_name: "标准",
    rubric_version: 1,
    rubric_hash: "sha256:rubric",
    base_run_id: null,
    progress: {},
    summary,
    error: null,
    created_by: null,
    started_at: null,
    finished_at: null,
    created_at: "2026-10-25T00:00:00.000Z",
  };
}

function result(itemId: string, position: number, status: EvalResultView["status"], score: number | null, query: string): EvalResultView {
  return {
    id: itemId,
    run_id: "R",
    item_id: itemId,
    position,
    status,
    score,
    session_id: null,
    answer: null,
    tool_names: [],
    stop_reason: null,
    rule_results: [],
    judge: null,
    usage: {},
    duration_ms: 1,
    error: status === "error" ? "timeout" : null,
    query,
  };
}

describe("compareEvalRuns", () => {
  it("counts fixes, regressions, errors, and sorts regressions first", () => {
    const comparison = compareEvalRuns(
      run("R1", 2, { pass_rate: 0.6, mean_score: 0.71, errored: 1 }),
      run("R2", 3, { pass_rate: 0.8, mean_score: 0.82, errored: 0 }),
      [
        result("I1", 2, "failed", 0.4, "问一"),
        result("I2", 1, "passed", 0.9, "问二"),
        result("I3", 3, "passed", 0.5, "问三"),
      ],
      [
        result("I1", 2, "passed", 0.9, "问一"),
        result("I2", 1, "failed", 0.2, "问二"),
        result("I3", 3, "error", null, "问三"),
      ],
    );
    expect(comparison.delta).toEqual({ pass_rate: 0.2, mean_score: 0.11 });
    expect(comparison.counts).toEqual({ fixed: 1, regressed: 1, unchanged: 0, errored: 1 });
    expect(comparison.items.map((item) => item.change)).toEqual(["regressed", "fixed", "errored"]);
  });

  it("rejects different dataset or rubric hashes", () => {
    const base = run("R1", 1, { pass_rate: 1, mean_score: 1 });
    const target = { ...run("R2", 2, { pass_rate: 1, mean_score: 1 }), dataset_hash: "sha256:other" };
    expect(() => compareEvalRuns(base, target, [], [])).toThrow(EvalCompareMismatchError);
  });
});
