/**
 * 统一 view model：把运行态 `SubAgent`（SSE / 轮询，实时）与落盘态
 * `SubAgentRunRecord`（Sub-Plan B 的 `/api/subagent/run` 等）归一为一套 `BadgeVM`，
 * 使工牌 / 集群卡片组件对两种数据源无感（Sub-Plan C FR-5 / AC-6）。
 */
import type { SubAgent, SubAgentStatus } from "../../store";
import { isTerminalStatus } from "./badge-theme";

/**
 * 落盘态 run record（对齐后端 `agenticx/runtime/subagent_runs/contracts.py` 的 RunRecord
 * 与 `/api/session/subagent-clusters` 的成员摘要）。字段可选以兼容摘要 / 明细两种粒度。
 */
export type SubAgentRunRecord = {
  run_id: string;
  kind?: string;
  name: string;
  role: string;
  task?: string;
  status: string;
  badge_seq?: string;
  cluster_id?: string;
  persona?: string | null;
  provider?: string | null;
  model?: string | null;
  avatar_id?: string | null;
  result_summary?: string | null;
  result_file?: string | null;
  output_files?: string[];
  activity_count?: number;
  updated_at?: number;
};

export type SubAgentCluster = {
  cluster_id: string;
  title: string;
  created_at: number;
  members: SubAgentRunRecord[];
};

export type BadgeVM = {
  runId: string;
  name: string;
  role: string;
  task?: string;
  persona?: string;
  provider?: string;
  model?: string;
  avatarId?: string;
  badgeSeq: string;
  status: SubAgentStatus | string;
  /** 0..1；运行态由事件 / progress 推断，落盘态由 status 映射；running 无精确值时为 undefined（呼吸推进）。 */
  progress?: number;
  resultSummary?: string;
  resultFile?: string;
  outputFiles?: string[];
  clusterId?: string;
  source: "live" | "persisted";
};

function normalizeSeq(seq: string | undefined, fallbackIndex?: number): string {
  const raw = String(seq ?? "").trim();
  if (raw) return raw;
  if (typeof fallbackIndex === "number") return String(fallbackIndex + 1).padStart(2, "0");
  return "";
}

/** 落盘态终态 → 进度映射（无 live 事件流时的静态收敛）。 */
function persistedProgressFor(status: string): number | undefined {
  if (status === "completed") return 1;
  if (status === "failed" || status === "cancelled") return undefined;
  if (status === "paused") return 0.6;
  if (status === "pending") return 0.02;
  // running：无精确进度 → undefined，交给像素进度条走「呼吸推进」。
  return undefined;
}

export function fromLiveSubAgent(s: SubAgent, fallbackIndex?: number): BadgeVM {
  const rawProgress = typeof s.progress === "number" ? s.progress : undefined;
  let progress: number | undefined;
  if (typeof rawProgress === "number") {
    progress = Math.max(0, Math.min(1, rawProgress > 1 ? rawProgress / 100 : rawProgress));
  } else if (isTerminalStatus(s.status)) {
    progress = s.status === "completed" ? 1 : undefined;
  }
  return {
    runId: s.id,
    name: s.name,
    role: s.role,
    task: s.task || undefined,
    provider: s.provider || undefined,
    model: s.model || undefined,
    badgeSeq: normalizeSeq(undefined, fallbackIndex),
    status: s.status,
    progress,
    resultSummary: s.resultSummary || undefined,
    resultFile: s.resultFile || undefined,
    outputFiles: s.outputFiles,
    source: "live",
  };
}

export function fromRunRecord(r: SubAgentRunRecord, fallbackIndex?: number): BadgeVM {
  return {
    runId: r.run_id,
    name: r.name,
    role: r.role,
    task: r.task || undefined,
    persona: r.persona || undefined,
    provider: r.provider || undefined,
    model: r.model || undefined,
    avatarId: r.avatar_id || undefined,
    badgeSeq: normalizeSeq(r.badge_seq, fallbackIndex),
    status: r.status,
    progress: persistedProgressFor(r.status),
    resultSummary: r.result_summary || undefined,
    resultFile: r.result_file || undefined,
    outputFiles: r.output_files,
    clusterId: r.cluster_id || undefined,
    source: "persisted",
  };
}

/**
 * 收敛：同一 cluster 的成员，运行态优先取 live（实时），完成后由落盘态补全 / 平滑替换。
 * 以 runId 为稳定键，live 覆盖 persisted 的动态字段，persisted 补 persona / avatar 等静态字段。
 */
export function mergeBadgeVMs(persisted: BadgeVM[], live: BadgeVM[]): BadgeVM[] {
  const liveById = new Map(live.map((vm) => [vm.runId, vm]));
  const merged: BadgeVM[] = persisted.map((p) => {
    const l = liveById.get(p.runId);
    if (!l) return p;
    liveById.delete(p.runId);
    // live 为运行时真相：状态 / 进度以 live 为准；persona / avatar / badgeSeq 保留落盘。
    return {
      ...p,
      status: l.status,
      task: l.task ?? p.task,
      progress: l.progress ?? p.progress,
      resultSummary: l.resultSummary ?? p.resultSummary,
      resultFile: l.resultFile ?? p.resultFile,
      outputFiles: l.outputFiles ?? p.outputFiles,
      provider: l.provider ?? p.provider,
      model: l.model ?? p.model,
      source: "live",
    };
  });
  // 仅 live 存在（落盘尚未写入）的成员追加到末尾。
  for (const l of liveById.values()) merged.push(l);
  return merged;
}
