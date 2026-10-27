import type { EvalCandidateRecord, EvalResultRecord, EvalRunRecord } from "@agenticx/iam-core";

export type EvalRunView = {
  id: string;
  tenant_id: string;
  kind: "eval" | "iterate";
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  agent_id: string;
  agent_version: number;
  environment_id: string | null;
  dataset_id: string | null;
  dataset_name: string;
  dataset_hash: string;
  rubric_id: string | null;
  rubric_name: string;
  rubric_version: number;
  rubric_hash: string;
  base_run_id: string | null;
  progress: { total?: number; done?: number; passed?: number; failed?: number; errored?: number };
  summary: {
    total?: number;
    passed?: number;
    failed?: number;
    errored?: number;
    pass_rate?: number | null;
    mean_score?: number | null;
    candidate_id?: string;
  };
  error: string | null;
  created_by: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
};

export type EvalResultView = {
  id: string;
  run_id: string;
  item_id: string;
  position: number;
  status: "passed" | "failed" | "error";
  score: number | null;
  session_id: string | null;
  answer: string | null;
  tool_names: string[];
  stop_reason: string | null;
  rule_results: { type: string; passed: boolean; detail: string }[];
  judge: { score: number; passed: boolean; reason: string; error: string | null } | null;
  usage: Record<string, number>;
  duration_ms: number;
  error: string | null;
  query?: string;
};

export type EvalCandidateView = {
  id: string;
  run_id: string;
  base_run_id: string;
  agent_id: string;
  base_version: number;
  manifest_hash: string;
  manifest: Record<string, unknown>;
  diff: { system?: string };
  rationale: string | null;
  status: "proposed" | "applied" | "discarded";
  applied_version: number | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
};

export function evalProgressPercent(progress: { done?: number; total?: number } | null | undefined): number {
  const total = progress?.total ?? 0;
  if (total <= 0) return 0;
  return Math.round(((progress?.done ?? 0) / total) * 100);
}

export function toEvalRunView(row: EvalRunRecord): EvalRunView {
  return {
    id: row.id,
    tenant_id: row.tenantId,
    kind: row.kind,
    status: row.status,
    agent_id: row.agentId,
    agent_version: row.agentVersion,
    environment_id: row.environmentId,
    dataset_id: row.datasetId,
    dataset_name: row.datasetName,
    dataset_hash: row.datasetHash,
    rubric_id: row.rubricId,
    rubric_name: row.rubricName,
    rubric_version: row.rubricVersion,
    rubric_hash: row.rubricHash,
    base_run_id: row.baseRunId,
    progress: row.progress,
    summary: row.summary as EvalRunView["summary"],
    error: row.error,
    created_by: row.createdBy,
    started_at: row.startedAt,
    finished_at: row.finishedAt,
    created_at: row.createdAt,
  };
}

export function toEvalResultView(row: EvalResultRecord, query?: string): EvalResultView {
  return {
    id: row.id,
    run_id: row.runId,
    item_id: row.itemId,
    position: row.position,
    status: row.status,
    score: row.scoreMilli == null ? null : row.scoreMilli / 1000,
    session_id: row.sessionId,
    answer: row.answer,
    tool_names: row.toolNames,
    stop_reason: row.stopReason,
    rule_results: row.ruleResults,
    judge: row.judge,
    usage: row.usage,
    duration_ms: row.durationMs,
    error: row.error,
    ...(query === undefined ? {} : { query }),
  };
}

export function toEvalCandidateView(row: EvalCandidateRecord): EvalCandidateView {
  return {
    id: row.id,
    run_id: row.runId,
    base_run_id: row.baseRunId,
    agent_id: row.agentId,
    base_version: row.baseVersion,
    manifest_hash: row.manifestHash,
    manifest: row.manifest,
    diff: row.diff,
    rationale: row.rationale,
    status: row.status,
    applied_version: row.appliedVersion,
    decided_by: row.decidedBy,
    decided_at: row.decidedAt,
    created_at: row.createdAt,
  };
}
