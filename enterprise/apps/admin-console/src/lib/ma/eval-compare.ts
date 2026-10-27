import type { EvalResultView, EvalRunView } from "./eval-records";

export class EvalCompareMismatchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalCompareMismatchError";
  }
}

export type EvalComparison = {
  base: { run_id: string; agent_version: number; summary: EvalRunView["summary"] };
  target: { run_id: string; agent_version: number; summary: EvalRunView["summary"] };
  delta: { pass_rate: number | null; mean_score: number | null };
  counts: { fixed: number; regressed: number; unchanged: number; errored: number };
  items: Array<{
    item_id: string;
    position: number;
    query: string;
    base: { status: string; score: number | null } | null;
    target: { status: string; score: number | null } | null;
    change: "fixed" | "regressed" | "unchanged" | "errored";
  }>;
};

const CHANGE_ORDER = ["regressed", "fixed", "errored", "unchanged"] as const;

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function side(row: EvalResultView | undefined): { status: string; score: number | null } | null {
  if (!row) return null;
  return { status: row.status, score: row.score };
}

function changeOf(base: EvalResultView | undefined, target: EvalResultView | undefined): EvalComparison["items"][number]["change"] {
  if (!base || !target || base.status === "error" || target.status === "error") return "errored";
  if (base.status === "failed" && target.status === "passed") return "fixed";
  if (base.status === "passed" && target.status === "failed") return "regressed";
  return "unchanged";
}

export function compareEvalRuns(
  base: EvalRunView,
  target: EvalRunView,
  baseResults: EvalResultView[],
  targetResults: EvalResultView[],
): EvalComparison {
  if (base.dataset_hash !== target.dataset_hash || base.rubric_hash !== target.rubric_hash) {
    throw new EvalCompareMismatchError("两次评测的评测集或评分标准内容不一致，无法对比");
  }
  const targetById = new Map(targetResults.map((row) => [row.item_id, row]));
  const baseById = new Map(baseResults.map((row) => [row.item_id, row]));
  const ids = new Set<string>([...baseById.keys(), ...targetById.keys()]);
  const items = [...ids].map((itemId) => {
    const left = baseById.get(itemId);
    const right = targetById.get(itemId);
    const change = changeOf(left, right);
    return {
      item_id: itemId,
      position: left?.position ?? right?.position ?? 0,
      query: (left?.query ?? right?.query ?? "").slice(0, 200),
      base: side(left),
      target: side(right),
      change,
    };
  });
  items.sort((a, b) => {
    const order = CHANGE_ORDER.indexOf(a.change) - CHANGE_ORDER.indexOf(b.change);
    if (order !== 0) return order;
    return a.position - b.position;
  });
  const counts = { fixed: 0, regressed: 0, unchanged: 0, errored: 0 };
  for (const item of items) counts[item.change] += 1;
  const baseRate = base.summary.pass_rate;
  const targetRate = target.summary.pass_rate;
  const baseMean = base.summary.mean_score;
  const targetMean = target.summary.mean_score;
  return {
    base: { run_id: base.id, agent_version: base.agent_version, summary: base.summary },
    target: { run_id: target.id, agent_version: target.agent_version, summary: target.summary },
    delta: {
      pass_rate: baseRate == null || targetRate == null ? null : round4(targetRate - baseRate),
      mean_score: baseMean == null || targetMean == null ? null : round4(targetMean - baseMean),
    },
    counts,
    items,
  };
}
