/**
 * In-memory group expert activity (not a chat Message).
 * Author: Damon Li
 */

export type GroupExpertActivityPhase = "thinking" | "tool" | "waiting";

export type GroupExpertToolStep = {
  callId: string;
  toolName: string;
  phase: "calling" | "done";
  updatedAt: number;
  /** Command / path / query shown in the folded list. */
  detail?: string;
  /** One-line result snippet after the tool finishes. */
  output?: string;
};

export type GroupExpertActivity = {
  agentId: string;
  avatarName: string;
  avatarUrl?: string;
  phase: GroupExpertActivityPhase;
  summary: string;
  startedAt: number;
  updatedAt: number;
  toolSteps: GroupExpertToolStep[];
};

export type GroupExpertActivityEvent = {
  type: "typing" | "progress" | "blocked" | "clarification";
  agentId: string;
  avatarName: string;
  avatarUrl?: string;
  content?: string;
  toolName?: string;
  toolPhase?: string;
  toolCallId?: string;
  toolDetail?: string;
  now: number;
};

export const TOOL_LABELS: Record<string, string> = {
  bash_exec: "终端",
  file_read: "文件读取",
  file_write: "文件写入",
  web_search: "网络检索",
  knowledge_search: "知识库检索",
  session_search: "历史检索",
};

const MAX_TOOL_STEPS = 6;
const RAW_TOOL_LINE_RE = /(?:正在调用工具|工具已完成)[：:]\s*([A-Za-z0-9_.-]+)/;

export function formatGroupToolLabel(toolName: string): string {
  const key = String(toolName ?? "").trim();
  if (!key) return "";
  return TOOL_LABELS[key] ?? "";
}

export function formatActivityElapsed(startedAt: number, now: number): string {
  const sec = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${sec}s`;
}

/** Drop typographic ellipsis; the card already shows animated dots on the right. */
export function stripTrailingStatusEllipsis(text: string): string {
  return String(text ?? "").replace(/(?:\.{3}|…)+\s*$/u, "").trimEnd();
}

export function hasActiveGroupExpertActivities(
  activities: Record<string, GroupExpertActivity>,
): boolean {
  return Object.keys(activities).length > 0;
}

export function sortGroupExpertActivities(
  activities: Record<string, GroupExpertActivity>,
): GroupExpertActivity[] {
  return Object.values(activities).sort((a, b) => {
    if (a.startedAt !== b.startedAt) return a.startedAt - b.startedAt;
    return a.agentId.localeCompare(b.agentId);
  });
}

export function parseToolNameFromProgressText(content: string): string {
  const match = String(content ?? "").trim().match(RAW_TOOL_LINE_RE);
  return match?.[1] ?? "";
}

function normalizeToolPhase(raw?: string): "calling" | "done" | "" {
  const phase = String(raw ?? "").trim();
  if (phase === "calling" || phase === "done") return phase;
  return "";
}

function formatToolSummary(toolName: string, phase: "calling" | "done"): string {
  const label = formatGroupToolLabel(toolName);
  if (!label) {
    return phase === "done" ? "工具已完成，继续处理中" : "正在执行工具";
  }
  return phase === "done" ? `已完成${label}，继续处理中` : `正在使用${label}`;
}

function sanitizeProgressContent(content?: string): string {
  const text = String(content ?? "").trim();
  if (!text) return "";
  if (/^开始处理任务/.test(text) || /^已接收任务/.test(text)) return "";
  if (RAW_TOOL_LINE_RE.test(text)) return "";
  if (/^[a-z][a-z0-9_]*$/.test(text)) return "";
  return stripTrailingStatusEllipsis(text);
}

function mergeToolSteps(
  current: GroupExpertToolStep[] | undefined,
  toolCallId: string,
  toolName: string,
  phase: "calling" | "done",
  now: number,
  toolDetail?: string,
): GroupExpertToolStep[] {
  const steps = current ? current.map((step) => ({ ...step })) : [];
  const idx = steps.findIndex((step) => step.callId === toolCallId);
  const prev = idx >= 0 ? steps[idx] : undefined;
  const clipped = String(toolDetail ?? "").trim();
  const nextStep: GroupExpertToolStep = {
    callId: toolCallId,
    toolName: toolName || prev?.toolName || "",
    phase,
    updatedAt: now,
    detail: phase === "calling" ? clipped || prev?.detail : prev?.detail,
    output: phase === "done" ? clipped || prev?.output : prev?.output,
  };
  if (!nextStep.detail) delete nextStep.detail;
  if (!nextStep.output) delete nextStep.output;
  if (idx >= 0) steps[idx] = { ...prev, ...nextStep };
  else steps.push(nextStep);
  return steps.length > MAX_TOOL_STEPS ? steps.slice(-MAX_TOOL_STEPS) : steps;
}

export function reduceGroupExpertActivity(
  current: GroupExpertActivity | undefined,
  event: GroupExpertActivityEvent,
): GroupExpertActivity {
  const now = Number.isFinite(event.now) ? event.now : Date.now();
  const agentId = String(event.agentId || current?.agentId || "").trim();
  const avatarName =
    String(event.avatarName ?? "").trim() || current?.avatarName || agentId;
  const incomingUrl = String(event.avatarUrl ?? "").trim();
  const avatarUrl = incomingUrl || current?.avatarUrl;
  const startedAt = current?.startedAt ?? now;

  let phase: GroupExpertActivityPhase = current?.phase ?? "thinking";
  let summary = current?.summary ?? "正在思考";
  let toolSteps = current?.toolSteps ? current.toolSteps.map((step) => ({ ...step })) : [];

  if (event.type === "typing") {
    phase = "thinking";
    summary = "正在思考";
  } else if (event.type === "blocked") {
    phase = "waiting";
    summary = "等待你的确认…";
  } else if (event.type === "clarification") {
    phase = "waiting";
    summary = "需要你补充信息…";
  } else if (event.type === "progress") {
    const parsedName =
      String(event.toolName ?? "").trim() || parseToolNameFromProgressText(event.content ?? "");
    const parsedPhase =
      normalizeToolPhase(event.toolPhase) ||
      (/(?:工具已完成)[：:]/.test(event.content ?? "")
        ? "done"
        : /(?:正在调用工具)[：:]/.test(event.content ?? "")
          ? "calling"
          : "");
    const callId = String(event.toolCallId ?? "").trim();

    if (parsedName && parsedPhase) {
      phase = "tool";
      summary = formatToolSummary(parsedName, parsedPhase);
      if (callId) {
        toolSteps = mergeToolSteps(
          toolSteps,
          callId,
          parsedName,
          parsedPhase,
          now,
          event.toolDetail,
        );
      }
    } else {
      const cleaned = sanitizeProgressContent(event.content);
      if (cleaned) {
        summary = cleaned;
      } else if (!current) {
        phase = "thinking";
        summary = "正在思考";
      }
    }
  }

  return {
    agentId,
    avatarName,
    ...(avatarUrl ? { avatarUrl } : {}),
    phase,
    summary,
    startedAt,
    updatedAt: now,
    toolSteps,
  };
}
