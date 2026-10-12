/**
 * Pure automation run-health transitions.
 * Callers truncate errors before applyRunOutcome. Inputs are never mutated.
 */

export const INTERRUPTED_TEXT =
  "上次运行在完成前中断（应用退出或进程崩溃），其中的外部操作可能已部分执行。请先查看那次会话，再决定是否重跑。";

export const AUTO_PAUSE_FAILURE_THRESHOLD = 3;

/**
 * Case-insensitive substring match, first hit wins.
 * "无人值守等待审批超时" is intentionally NOT in this table: missing one
 * approval is normal and is left to the consecutive-failure threshold.
 */
export const NEEDS_USER_ACTION_MARKERS: ReadonlyArray<{ needle: string; label: string }> = [
  { needle: "无人值守运行不批准受保护操作", label: "任务里有需要批准的操作" },
  { needle: "企业登录已失效", label: "企业账号登录已失效" },
  { needle: "invalid_api_key", label: "模型 API Key 无效" },
  { needle: "incorrect api key", label: "模型 API Key 无效" },
  { needle: "http 401", label: "鉴权失败" },
  { needle: "http 403", label: "没有权限" },
];

export type RunHealthFields = {
  enabled: boolean;
  lastRunAt?: string;
  lastRunStatus?: "success" | "error" | "interrupted";
  lastRunError?: string;
  runningSince?: string;
  consecutiveFailures?: number;
  autoPausedReason?: string;
  autoPausedAt?: string;
};

export function matchNeedsUserAction(error: string | undefined): string | null {
  const text = (error ?? "").toLowerCase();
  if (!text) return null;
  for (const marker of NEEDS_USER_ACTION_MARKERS) {
    if (text.includes(marker.needle.toLowerCase())) return marker.label;
  }
  return null;
}

export function markRunStarted<T extends RunHealthFields>(task: T, nowIso: string): T {
  return { ...task, runningSince: nowIso };
}

export function applyRunOutcome<T extends RunHealthFields>(
  task: T,
  outcome: { ok: boolean; error?: string },
  opts: { trigger: "schedule" | "manual"; nowIso: string },
): T {
  if (outcome.ok) {
    const next: T = {
      ...task,
      lastRunAt: opts.nowIso,
      lastRunStatus: "success",
      consecutiveFailures: 0,
    };
    delete next.lastRunError;
    if (opts.trigger === "schedule") delete next.runningSince;
    return next;
  }

  const next: T = {
    ...task,
    lastRunAt: opts.nowIso,
    lastRunStatus: "error",
    lastRunError: outcome.error ?? "",
  };
  if (opts.trigger === "manual") return next;

  delete next.runningSince;
  const previous = typeof task.consecutiveFailures === "number" && Number.isFinite(task.consecutiveFailures)
    ? task.consecutiveFailures
    : 0;
  const consecutiveFailures = previous + 1;
  next.consecutiveFailures = consecutiveFailures;
  const label = matchNeedsUserAction(next.lastRunError);
  if (label) {
    next.enabled = false;
    next.autoPausedReason = `需要你处理：${label}`;
    next.autoPausedAt = opts.nowIso;
  } else if (consecutiveFailures >= AUTO_PAUSE_FAILURE_THRESHOLD) {
    next.enabled = false;
    next.autoPausedReason = `连续失败 ${consecutiveFailures} 次，已自动暂停`;
  }
  return next;
}

export function markInterruptedOnStartup<T extends RunHealthFields>(
  task: T,
  runningIds: ReadonlySet<string>,
  id: string,
): T {
  if (!task.runningSince) return task;
  if (runningIds.has(id)) return task;
  const next: T = {
    ...task,
    lastRunStatus: "interrupted",
    lastRunError: INTERRUPTED_TEXT,
  };
  delete next.runningSince;
  return next;
}

export function applyUserEnableToggle<T extends RunHealthFields>(prev: T | undefined, next: T): T {
  const out: T = { ...next };
  if (prev) {
    if (out.runningSince === undefined && prev.runningSince !== undefined) {
      out.runningSince = prev.runningSince;
    }
    if (out.consecutiveFailures === undefined && prev.consecutiveFailures !== undefined) {
      out.consecutiveFailures = prev.consecutiveFailures;
    }
    if (out.autoPausedReason === undefined && prev.autoPausedReason !== undefined) {
      out.autoPausedReason = prev.autoPausedReason;
    }
    if (out.autoPausedAt === undefined && prev.autoPausedAt !== undefined) {
      out.autoPausedAt = prev.autoPausedAt;
    }
  }
  if (prev && prev.enabled === false && next.enabled === true) {
    delete out.autoPausedReason;
    delete out.autoPausedAt;
    out.consecutiveFailures = 0;
  }
  return out;
}
