const TASKSPACE_LIMIT_RE = /taskspace limit reached\s*\((\d+)\)/i;

export function extractTaskspaceLimitFromError(raw: string | undefined): number | null {
  const text = String(raw ?? "");
  const direct = text.match(TASKSPACE_LIMIT_RE);
  if (direct?.[1]) {
    const n = Number(direct[1]);
    return Number.isFinite(n) ? n : null;
  }
  if (!text.startsWith("HTTP ")) return null;
  const jsonPart = text.replace(/^HTTP \d+:\s*/, "");
  try {
    const parsed = JSON.parse(jsonPart) as { detail?: string };
    const detail = String(parsed.detail ?? "");
    const fromDetail = detail.match(TASKSPACE_LIMIT_RE);
    if (fromDetail?.[1]) {
      const n = Number(fromDetail[1]);
      return Number.isFinite(n) ? n : null;
    }
  } catch {
    // ignore malformed JSON bodies
  }
  return null;
}

export function formatTaskspaceAddError(raw: string | undefined, fallbackLimit = 20): string {
  const limit = extractTaskspaceLimitFromError(raw) ?? fallbackLimit;
  const text = String(raw ?? "");
  if (TASKSPACE_LIMIT_RE.test(text) || extractTaskspaceLimitFromError(text) !== null) {
    return `已达工作区上限（当前最多 ${limit} 个，含默认工作区）。可在「设置 → 工具 → 运行时参数」调高上限，或先移除不常用的目录。`;
  }
  return text || "添加工作区失败";
}

export function countManualTaskspaces(taskspaces: Array<{ id: string }>): number {
  return taskspaces.filter((item) => item.id !== "default").length;
}

export function isTaskspaceAtLimit(
  taskspaces: Array<{ id: string }>,
  maxTaskspaces: number,
): boolean {
  const limit = Math.max(1, maxTaskspaces);
  return taskspaces.length >= limit || countManualTaskspaces(taskspaces) >= Math.max(0, limit - 1);
}
