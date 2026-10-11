import type { Message } from "../store";

export type JevPurpose = "group_routing" | "kb_auto";
export type JevSource = "jev" | "fallback";

export type JevDecisionPayload = {
  kind: "jev_decision" | "jev_kb_gate";
  phase: "pending" | "done";
  purpose: JevPurpose;
  source: JevSource;
  model: string;
  requested_model: string;
  action: string;
  target_ids: string[];
  target_labels: string[];
  requires_execution: boolean;
  confidence: number | null;
  gate: string;
  probabilities: Record<string, number>;
  noul_execution: number | null;
  latency_ms: number;
  fallback_reason: string;
};

const ACTION_LABEL_ZH: Record<string, string> = {
  route_to: "派给成员",
  meta_direct: "Near 作答",
  continue_thread: "续聊",
  open_floor: "开放麦",
  search: "检索知识库",
  skip: "跳过检索",
};

const FALLBACK_CAUSE_ZH: Record<string, string> = {
  jev_no_key: "未配置密钥",
  jev_timeout: "超时",
  jev_http: "请求失败",
  jev_fallback_llm: "置信不足",
  jev_soft_timeout: "判定较慢",
  jev_fallback_meta: "已回落 Near",
};

const HARD_FALLBACK_REASONS = new Set(["jev_no_key", "jev_timeout", "jev_http"]);

const GATE_LABEL_ZH: Record<string, string> = {
  auto: "自动",
  review: "建议复核",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function asFloat(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function asStringMap(value: unknown): Record<string, number> {
  const raw = asRecord(value);
  if (!raw) return {};
  const out: Record<string, number> = {};
  for (const [key, item] of Object.entries(raw)) {
    const n = asFloat(item);
    if (n == null) continue;
    out[key] = n;
  }
  return out;
}

export function parseJevDecision(raw: unknown): JevDecisionPayload | null {
  const rec = asRecord(raw);
  if (!rec) return null;
  const kind = String(rec.kind ?? "").trim();
  if (kind !== "jev_decision" && kind !== "jev_kb_gate") return null;
  const phase = String(rec.phase ?? "done").trim() === "pending" ? "pending" : "done";
  const purpose = String(rec.purpose ?? "group_routing").trim() === "kb_auto" ? "kb_auto" : "group_routing";
  const source = String(rec.source ?? "").trim() === "jev" ? "jev" : "fallback";
  const targetIds = Array.isArray(rec.target_ids) ? rec.target_ids.map((x) => String(x)).filter(Boolean) : [];
  const targetLabels = Array.isArray(rec.target_labels)
    ? rec.target_labels.map((x) => String(x)).filter(Boolean)
    : [];
  return {
    kind,
    phase,
    purpose,
    source,
    model: String(rec.model ?? "").trim(),
    requested_model: String(rec.requested_model ?? rec.model ?? "").trim(),
    action: String(rec.action ?? "").trim(),
    target_ids: targetIds,
    target_labels: targetLabels,
    requires_execution: rec.requires_execution === true,
    confidence: asFloat(rec.confidence),
    gate: String(rec.gate ?? "").trim(),
    probabilities: asStringMap(rec.probabilities),
    noul_execution: asFloat(rec.noul_execution),
    latency_ms: Math.max(0, Math.round(asFloat(rec.latency_ms) ?? 0)),
    fallback_reason: String(rec.fallback_reason ?? "").trim(),
  };
}

export function jevActionLabelZh(action: string, purpose: JevPurpose = "group_routing"): string {
  if (purpose === "kb_auto") {
    if (action === "skip") return "跳过检索";
    if (action === "search") return "检索知识库";
  }
  return ACTION_LABEL_ZH[action] ?? action;
}

export function jevKbActionLabel(payload: JevDecisionPayload): string {
  if (payload.action === "skip") return "跳过检索";
  if (payload.action === "search") return "检索知识库";
  if (payload.noul_execution != null && payload.noul_execution < 0.7) return "跳过检索";
  return "检索知识库";
}

export function jevFallbackCauseZh(reason: string): string {
  return FALLBACK_CAUSE_ZH[reason] ?? (reason || "未采用");
}

export function isJevHardFallback(reason: string): boolean {
  return HARD_FALLBACK_REASONS.has(String(reason || "").trim());
}

export function jevFallbackLineZh(reason: string): string {
  const code = String(reason || "").trim();
  if (code === "jev_fallback_llm") return "改走主模型 · 置信不足";
  if (code === "jev_soft_timeout") return "改走主模型 · 判定较慢";
  if (code === "jev_fallback_meta") return "改走 Near · 已回落 Near";
  return `未采用 · ${jevFallbackCauseZh(code)}`;
}

export function jevGateLabelZh(gate: string): string {
  return GATE_LABEL_ZH[gate] ?? gate;
}

export function jevTargetLabel(payload: JevDecisionPayload): string {
  if (payload.purpose === "kb_auto") return jevKbActionLabel(payload);
  if (payload.action === "meta_direct" || payload.target_labels.length === 0) return "Near";
  return payload.target_labels.join("、");
}

export function jevConfidencePct(confidence: number | null): number | null {
  if (confidence == null) return null;
  return Math.max(0, Math.min(100, Math.round(confidence * 100)));
}

export function isJevDecisionMessage(
  message: Pick<Message, "role" | "toolName" | "metadata" | "agentId">,
): boolean {
  if (message.role !== "tool") return false;
  if ((message.toolName ?? "").trim() === "jev") return true;
  const kind = String(message.metadata?.kind ?? "").trim();
  return kind === "jev_decision" || kind === "jev_kb_gate";
}

export function jevPayloadFromMessage(
  message: Pick<Message, "metadata" | "toolStatus" | "toolArgs">,
): JevDecisionPayload | null {
  const parsed = parseJevDecision(message.metadata) ?? parseJevDecision(message.toolArgs);
  if (parsed) {
    if (message.toolStatus === "running" || message.toolStatus === "pending") {
      return { ...parsed, phase: "pending" };
    }
    return parsed;
  }
  if (message.toolStatus === "running" || message.toolStatus === "pending") {
    return {
      kind: "jev_decision",
      phase: "pending",
      purpose: "group_routing",
      source: "fallback",
      model: "",
      requested_model: "",
      action: "",
      target_ids: [],
      target_labels: [],
      requires_execution: false,
      confidence: null,
      gate: "",
      probabilities: {},
      noul_execution: null,
      latency_ms: 0,
      fallback_reason: "",
    };
  }
  return null;
}

export function latestJevDecision(messages: Array<Pick<Message, "role" | "toolName" | "metadata" | "agentId">>) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (!isJevDecisionMessage(message)) continue;
    const parsed = parseJevDecision(message.metadata);
    if (parsed && parsed.phase !== "pending") return parsed;
  }
  return null;
}
