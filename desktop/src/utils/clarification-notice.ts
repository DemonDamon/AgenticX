/**
 * Helpers for the human-in-the-loop clarification flow (request_clarification).
 *
 * These mirror the backend `build_clarification_tool_result` so the frontend
 * can show an optimistic preview of the answer text that will be fed back to
 * the agent, and dedupe against the persisted chat_history row.
 */

import type { ChoicePanelOption, PendingClarification } from "../store";

export type ClarificationAnswer = {
  answerText: string;
  selectedOptions: string[];
  /** Versioned choice panel select payload (present_choices). */
  panelId?: string;
  candidateSetVersion?: number;
  optionId?: string;
};

export type ClarificationDecisionPayload = {
  id: string;
  question: string;
  options: string[];
  selectionMode: "single" | "multiple";
  exclusiveOptions: string[];
};

export type PendingClarificationPayload = {
  requestId: string;
  prompt: string;
  options: string[];
  decisions?: ClarificationDecisionPayload[];
  allowFreeText: boolean;
  agentId: string;
  sessionId: string;
  context?: Record<string, unknown> | undefined;
  panelId?: string;
  candidateSetVersion?: number;
  panelType?: "clarification" | "comparison";
  choiceOptions?: ChoicePanelOption[];
  superseded?: boolean;
};

/** Extract versioned choice-panel fields from clarification context / metadata. */
export function parseChoicePanelFields(
  context: Record<string, unknown> | undefined | null,
): Pick<
  PendingClarification,
  "panelId" | "candidateSetVersion" | "panelType" | "choiceOptions" | "superseded"
> {
  if (!context || typeof context !== "object") return {};
  if (context.kind !== "choice_panel") return {};
  const panelId = String(context.panel_id ?? "").trim() || undefined;
  const rawVersion = context.candidate_set_version;
  const candidateSetVersion =
    typeof rawVersion === "number" && Number.isFinite(rawVersion)
      ? rawVersion
      : typeof rawVersion === "string" && rawVersion.trim()
        ? Number(rawVersion)
        : undefined;
  const panelType =
    context.panel_type === "comparison"
      ? ("comparison" as const)
      : context.panel_type === "clarification"
        ? ("clarification" as const)
        : undefined;
  const rawOpts = Array.isArray(context.choice_options) ? context.choice_options : [];
  const choiceOptions: ChoicePanelOption[] = [];
  for (const item of rawOpts.slice(0, 12)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const id = String(rec.id ?? "").trim();
    const label = String(rec.label ?? "").trim();
    if (!id || !label) continue;
    const details = Array.isArray(rec.details)
      ? rec.details.map((d) => String(d).trim()).filter(Boolean).slice(0, 4)
      : [];
    const sources: ChoicePanelOption["sources"] = [];
    if (Array.isArray(rec.sources)) {
      for (const s of rec.sources.slice(0, 5)) {
        if (!s || typeof s !== "object") continue;
        const src = s as Record<string, unknown>;
        const title = String(src.title ?? "").trim();
        const url = String(src.url ?? "").trim();
        if (!title || !url) continue;
        if (!/^https?:\/\//i.test(url)) continue;
        sources.push({ title, url });
      }
    }
    choiceOptions.push({
      id,
      label,
      details: details.length > 0 ? details : undefined,
      sources: sources.length > 0 ? sources : undefined,
    });
  }
  return {
    panelId,
    candidateSetVersion:
      candidateSetVersion !== undefined && Number.isFinite(candidateSetVersion)
        ? candidateSetVersion
        : undefined,
    panelType,
    choiceOptions: choiceOptions.length > 0 ? choiceOptions : undefined,
    superseded: context.superseded === true,
  };
}

/**
 * Attach panel_id / candidate_set_version / option_id onto a clarify POST body
 * when the answer (or prompt) carries versioned choice-panel fields.
 */
export function buildClarifyRequestBody(args: {
  sessionId: string;
  requestId: string;
  agentId?: string;
  answer: ClarificationAnswer;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    session_id: args.sessionId,
    request_id: args.requestId,
    agent_id: args.agentId || "meta",
    answer_text: args.answer.answerText ?? "",
    selected_options: args.answer.selectedOptions ?? [],
  };
  const panelId = (args.answer.panelId || "").trim();
  if (panelId) {
    body.panel_id = panelId;
    if (
      typeof args.answer.candidateSetVersion === "number" &&
      Number.isFinite(args.answer.candidateSetVersion)
    ) {
      body.candidate_set_version = args.answer.candidateSetVersion;
    }
    const optionId = (args.answer.optionId || "").trim();
    if (optionId) body.option_id = optionId;
  }
  return body;
}

function normalizeExclusiveOptions(
  raw: unknown,
  options: string[],
  selectionMode: "single" | "multiple",
): string[] {
  if (selectionMode !== "multiple" || !Array.isArray(raw)) return [];
  const optionSet = new Set(options);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const label of raw) {
    const text = String(label ?? "").trim();
    if (!text || !optionSet.has(text) || seen.has(text)) continue;
    seen.add(text);
    out.push(text);
  }
  return out;
}

export function parseClarificationDecisions(raw: unknown): ClarificationDecisionPayload[] {
  if (!Array.isArray(raw)) return [];
  const out: ClarificationDecisionPayload[] = [];
  for (const item of raw.slice(0, 6)) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const question = String(rec.question ?? "").trim();
    const rawOpts = Array.isArray(rec.options) ? rec.options : [];
    const options = rawOpts.map((o) => String(o).trim()).filter(Boolean).slice(0, 8);
    if (!question || options.length === 0) continue;
    const id = String(rec.id ?? "").trim() || `decision-${out.length + 1}`;
    const selectionMode = rec.selection_mode === "multiple" ? "multiple" : "single";
    const exclusiveOptions = normalizeExclusiveOptions(
      rec.exclusive_options,
      options,
      selectionMode,
    );
    out.push({ id, question, options, selectionMode, exclusiveOptions });
  }
  return out;
}

/** Best-effort: bucket flat options into context dimensions for legacy tool calls. */
export function inferClarificationDecisions(
  context: Record<string, unknown> | undefined,
  options: string[],
): ClarificationDecisionPayload[] {
  if (!context || options.length < 2) return [];
  const dimensions = Object.entries(context)
    .filter(([k, v]) => k !== "request_id" && v !== null && v !== undefined && String(v).trim())
    .slice(0, 6);
  if (dimensions.length < 2) return [];

  const buckets = new Map<string, ClarificationDecisionPayload>();
  for (const [key] of dimensions) {
    buckets.set(key, {
      id: key,
      question: `关于「${key}」的决策`,
      options: [],
      selectionMode: "single",
      exclusiveOptions: [],
    });
  }
  const other: ClarificationDecisionPayload = {
    id: "__overall__",
    question: "整体确认",
    options: [],
    selectionMode: "single",
    exclusiveOptions: [],
  };

  for (const opt of options) {
    let matchedKey: string | null = null;
    for (const [key] of dimensions) {
      if (opt.includes(key)) {
        matchedKey = key;
        break;
      }
    }
    if (!matchedKey) {
      if (/直接开工|按当前|默认推进|全部确认/i.test(opt)) {
        other.options.push(opt);
        continue;
      }
      // Heuristic keyword buckets for common production sign-off wording.
      if (/时长|分钟|秒|帧|90|120|2分钟/i.test(opt)) matchedKey = dimensions.find(([k]) => /时长|时间|duration/i.test(k))?.[0] ?? null;
      else if (/文案|旁白|字幕|改写/i.test(opt)) matchedKey = dimensions.find(([k]) => /文案|旁白|copy/i.test(k))?.[0] ?? null;
      else if (/配色|色调|风格|深蓝|科技金|更亮|更暗/i.test(opt)) matchedKey = dimensions.find(([k]) => /色|调|palette|风格/i.test(k))?.[0] ?? null;
    }
    if (matchedKey && buckets.has(matchedKey)) {
      buckets.get(matchedKey)!.options.push(opt);
    } else {
      other.options.push(opt);
    }
  }

  const out = [...buckets.values()].filter((b) => b.options.length > 0);
  if (other.options.length > 0) out.push(other);
  return out.length >= 2 ? out : [];
}

/**
 * Toggle a decision option. Output order always follows ``decision.options``.
 *
 * - single: exclusive select / click again to clear
 * - multiple exclusive: selecting clears others; click again clears
 * - multiple normal: toggle while clearing any currently selected exclusive
 */
export function toggleDecisionSelection(
  decision: ClarificationDecisionPayload,
  current: string[],
  option: string,
): string[] {
  const allowed = new Set(decision.options);
  if (!allowed.has(option)) {
    return decision.options.filter((o) => current.includes(o));
  }

  if (decision.selectionMode === "single") {
    if (current.includes(option) && current.length === 1) return [];
    return [option];
  }

  const exclusiveSet = new Set(decision.exclusiveOptions);
  const isExclusive = exclusiveSet.has(option);
  const selected = new Set(current.filter((o) => allowed.has(o)));

  if (isExclusive) {
    if (selected.has(option) && selected.size === 1) return [];
    return [option];
  }

  for (const ex of exclusiveSet) selected.delete(ex);
  if (selected.has(option)) selected.delete(option);
  else selected.add(option);
  return decision.options.filter((o) => selected.has(o));
}

/**
 * Render the structured user answer as the same natural-language text the
 * backend will inject as the tool result. Used for optimistic UI preview
 * before the backend round-trips.
 */
export function buildClarificationAnswerText(answer: ClarificationAnswer): string {
  const text = (answer.answerText || "").trim();
  const selected = (answer.selectedOptions || [])
    .map((o) => (typeof o === "string" ? o.trim() : ""))
    .filter(Boolean);
  const parts: string[] = [];
  if (selected.length > 0) {
    parts.push(`用户选择：${selected.join("；")}`);
  }
  if (text) {
    parts.push(`自定义补充：${text}`);
  }
  if (parts.length === 0) {
    return "用户未提供具体内容（视为按你的默认方案推进）。";
  }
  return `${parts.join("；")}。`;
}

/**
 * Whether an incoming chat_history row (from disk or SSE) is a persisted
 * clarification prompt that should render as an inline card.
 */
export function isClarificationMessage(meta: unknown): boolean {
  if (!meta || typeof meta !== "object") return false;
  const kind = (meta as Record<string, unknown>).kind;
  return kind === "clarification";
}

/**
 * Build a PendingClarificationPayload from a persisted metadata block (used
 * when reconstructing the inline card from disk on session switch / refresh).
 */
export function clarificationPayloadFromMeta(
  meta: Record<string, unknown>,
  agentId: string,
  sessionId: string,
): PendingClarificationPayload | null {
  if (!isClarificationMessage(meta)) return null;
  const m = meta as Record<string, unknown>;
  const requestId = String(m.request_id || m.id || "");
  if (!requestId) return null;
  const rawOptions = Array.isArray(m.options) ? m.options : [];
  const decisions = parseClarificationDecisions(m.decisions);
  const context = (m.context as Record<string, unknown> | undefined) ?? undefined;
  const choiceFields = parseChoicePanelFields(context);
  return {
    requestId,
    prompt: String(m.prompt || ""),
    options: rawOptions.map((o) => String(o)).filter(Boolean),
    decisions: decisions.length > 0 ? decisions : undefined,
    allowFreeText: m.allow_free_text !== false,
    agentId,
    sessionId,
    context,
    ...choiceFields,
  };
}
