export type ClarifyResumeParseResult =
  | { kind: "resumed" }
  | { kind: "already_continued"; message: string }
  | { kind: "error"; message: string };

const ALREADY_CONTINUED_MESSAGE =
  "澄清窗口已结束，任务已按默认假设继续；本次选择未再写入。";

function tryParseJson(text: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed) as unknown;
  } catch {
    return null;
  }
}

function readErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const nested = root.error;
  if (nested && typeof nested === "object") {
    const code = (nested as Record<string, unknown>).code;
    if (typeof code === "string" && code.trim()) return code.trim();
  }
  if (typeof root.code === "string" && root.code.trim()) return root.code.trim();
  return null;
}

function readErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const nested = root.error;
  if (nested && typeof nested === "object") {
    const message = (nested as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  if (typeof root.message === "string" && root.message.trim()) return root.message.trim();
  return null;
}

/**
 * Normalize /api/chat/deep-research/resume responses for the clarify card.
 * - 200 + resumed → success
 * - 200 + alreadyContinued / legacy 40401 → soft success (task already moved on)
 * - other failures → user-facing Chinese (never dump raw JSON)
 */
export function parseClarifyResumeResponse(
  status: number,
  bodyText: string,
): ClarifyResumeParseResult {
  const payload = tryParseJson(bodyText);
  const code = readErrorCode(payload);
  const data =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).data
      : undefined;
  const dataObj =
    data && typeof data === "object" ? (data as Record<string, unknown>) : null;

  if (status >= 200 && status < 300) {
    if (dataObj?.alreadyContinued === true || dataObj?.resumed === false) {
      return { kind: "already_continued", message: ALREADY_CONTINUED_MESSAGE };
    }
    return { kind: "resumed" };
  }

  if (
    status === 404 ||
    code === "40401" ||
    readErrorMessage(payload)?.includes("no pending clarify")
  ) {
    return { kind: "already_continued", message: ALREADY_CONTINUED_MESSAGE };
  }

  const detail = readErrorMessage(payload);
  if (detail && !detail.startsWith("{")) {
    return { kind: "error", message: detail };
  }
  return {
    kind: "error",
    message: status ? `提交失败（HTTP ${status}）` : "提交失败",
  };
}
