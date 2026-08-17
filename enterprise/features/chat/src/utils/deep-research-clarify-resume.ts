export type ClarifyResumeParseResult =
  | {
      kind: "resumed";
      plan?: {
        version: number;
        objective: string;
        scope: string[];
        subQuestions: Array<{ id: string; title: string; purpose?: string }>;
        sourceStrategy: string[];
        deliverables: string[];
        assumptions: string[];
      };
      version?: number;
    }
  | { kind: "already_continued"; message: string }
  | { kind: "error"; message: string };

export type ClarifyResumeGateKind = "clarify" | "plan";

const ALREADY_CONTINUED_CLARIFY =
  "澄清窗口已结束，任务已按默认假设继续；本次选择未再写入。";
const ALREADY_CONTINUED_PLAN =
  "计划确认已结束，任务已继续；本次修改未再写入。若研究已开始，可直接查看进度。";

function alreadyContinuedMessage(gate: ClarifyResumeGateKind): string {
  return gate === "plan" ? ALREADY_CONTINUED_PLAN : ALREADY_CONTINUED_CLARIFY;
}

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
 * Normalize /api/chat/deep-research/resume responses for clarify / plan gates.
 * - 200 + resumed → success
 * - 200 + alreadyContinued / legacy 40401 → soft success (task already moved on)
 * - other failures → user-facing Chinese (never dump raw JSON)
 */
export function parseClarifyResumeResponse(
  status: number,
  bodyText: string,
  gate: ClarifyResumeGateKind = "clarify",
): ClarifyResumeParseResult {
  const payload = tryParseJson(bodyText);
  const code = readErrorCode(payload);
  const data =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>).data
      : undefined;
  const dataObj =
    data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  const continuedMessage = alreadyContinuedMessage(gate);

  if (status >= 200 && status < 300) {
    if (dataObj?.alreadyContinued === true || dataObj?.resumed === false) {
      return { kind: "already_continued", message: continuedMessage };
    }
    const planRaw = dataObj?.plan;
    const versionRaw = dataObj?.version;
    const version =
      typeof versionRaw === "number" && Number.isFinite(versionRaw)
        ? versionRaw
        : undefined;
    if (planRaw && typeof planRaw === "object" && !Array.isArray(planRaw)) {
      const plan = planRaw as Record<string, unknown>;
      const objective = typeof plan.objective === "string" ? plan.objective : "";
      const subQuestions = Array.isArray(plan.subQuestions)
        ? plan.subQuestions
            .filter(
              (item): item is Record<string, unknown> =>
                Boolean(item) && typeof item === "object",
            )
            .map((item, index) => ({
              id:
                typeof item.id === "string" && item.id.trim()
                  ? item.id.trim()
                  : `sq${index + 1}`,
              title: typeof item.title === "string" ? item.title : "",
              ...(typeof item.purpose === "string" && item.purpose.trim()
                ? { purpose: item.purpose.trim() }
                : {}),
            }))
            .filter((item) => item.title.trim())
        : [];
      if (objective && subQuestions.length > 0) {
        const asStrings = (value: unknown): string[] =>
          Array.isArray(value)
            ? value.filter(
                (item): item is string =>
                  typeof item === "string" && item.trim().length > 0,
              )
            : [];
        return {
          kind: "resumed",
          version:
            version ??
            (typeof plan.version === "number" ? plan.version : undefined),
          plan: {
            version:
              version ??
              (typeof plan.version === "number" && Number.isFinite(plan.version)
                ? plan.version
                : 1),
            objective,
            scope: asStrings(plan.scope),
            subQuestions,
            sourceStrategy: asStrings(plan.sourceStrategy),
            deliverables: asStrings(plan.deliverables),
            assumptions: asStrings(plan.assumptions),
          },
        };
      }
    }
    return { kind: "resumed", ...(version != null ? { version } : {}) };
  }

  if (
    status === 404 ||
    code === "40401" ||
    readErrorMessage(payload)?.includes("no pending clarify")
  ) {
    return { kind: "already_continued", message: continuedMessage };
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
