import type {
  ChatMessage,
  ChatMessageAttachment,
  ChatMessageDeepResearch,
  DeepResearchEvent,
  WebSearchSource,
} from "@agenticx/core-api";
import { sanitizeWebSearchTrace } from "@agenticx/core-api";
import { isTraceId } from "@agenticx/sdk-ts";

const ALLOWED_ROLES = new Set(["system", "user", "assistant", "tool"]);
const ULID_RE = /^[0-7][0-9A-HJKMNP-TV-Z]{25}$/;
export const MAX_MESSAGES_PER_WRITE = 100;
export const MAX_MESSAGE_CONTENT_CHARS = 128_000;
export const MAX_IMAGE_ATTACHMENTS = 50;
/** Base64 data URLs for up to ~5MB images. */
export const MAX_ATTACHMENT_DATA_URL_CHARS = 8_000_000;
export const MAX_ATTACHMENT_PARSED_TEXT_CHARS = 120_000;
export const MAX_WEB_SEARCH_SOURCES = 50;
export const MAX_SOURCE_FIELD_CHARS = 4_000;
/** Provider timestamps are short strings; anything longer is not one. */
export const MAX_PUBLISHED_AT_CHARS = 64;
export const MAX_DEEP_RESEARCH_EVENTS = 200;

function sanitizeAttachments(raw: unknown): ChatMessageAttachment[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) throw new Error("invalid attachments");
  if (raw.length > MAX_IMAGE_ATTACHMENTS) {
    throw new Error(`attachments must be <= ${MAX_IMAGE_ATTACHMENTS}`);
  }

  const out: ChatMessageAttachment[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") throw new Error("invalid attachment entry");
    const row = item as Record<string, unknown>;
    const name = typeof row.name === "string" ? row.name.trim() : "";
    const mimeType = typeof row.mime_type === "string" ? row.mime_type.trim() : "";
    const dataUrl = typeof row.data_url === "string" ? row.data_url.trim() : "";
    const parsedText =
      typeof row.parsed_text === "string" ? row.parsed_text.trim().slice(0, MAX_ATTACHMENT_PARSED_TEXT_CHARS) : "";
    const kindRaw = typeof row.kind === "string" ? row.kind.trim() : "";
    const kind =
      kindRaw === "image" || kindRaw === "document" || kindRaw === "video"
        ? kindRaw
        : mimeType.startsWith("image/")
          ? "image"
          : mimeType.startsWith("video/")
            ? "video"
            : "document";
    if (!name) throw new Error("attachment name required");
    if (!mimeType) throw new Error("attachment mime_type required");

    if (kind === "image") {
      if (!mimeType.startsWith("image/")) throw new Error("image attachment mime_type must be image/*");
      // History outbox strips data_url for size/privacy; metadata-only rows are valid.
      // When a data_url is present, keep the existing image-data-URL checks.
      if (dataUrl) {
        if (!dataUrl.startsWith("data:image/")) throw new Error("attachment data_url must be image data URL");
        if (dataUrl.length > MAX_ATTACHMENT_DATA_URL_CHARS) throw new Error("attachment data_url too large");
      }
    } else if (kind === "document") {
      // History append intentionally sends {name,mime_type,size,kind} without parsed_text
      // (see stripToAppendPayload). Accept metadata-only; keep parsed_text when provided.
    } else if (kind === "video") {
      // Filename-only placeholder for now; binary is not forwarded to the model.
    } else {
      throw new Error("unsupported attachment kind");
    }

    const size = typeof row.size === "number" && Number.isFinite(row.size) ? row.size : undefined;
    const attachmentIdRaw = typeof row.attachment_id === "string" ? row.attachment_id.trim() : "";
    const attachmentId = ULID_RE.test(attachmentIdRaw) ? attachmentIdRaw : undefined;
    out.push({
      name,
      mime_type: mimeType,
      size,
      kind,
      ...(dataUrl ? { data_url: dataUrl } : {}),
      ...(parsedText ? { parsed_text: parsedText } : {}),
      ...(attachmentId ? { attachment_id: attachmentId } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeWebSearchSources(raw: unknown): WebSearchSource[] | undefined {
  if (raw == null) return undefined;
  if (!Array.isArray(raw)) throw new Error("invalid web_search_sources");
  if (raw.length > MAX_WEB_SEARCH_SOURCES) {
    throw new Error(`web_search_sources must be <= ${MAX_WEB_SEARCH_SOURCES}`);
  }
  const out: WebSearchSource[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") throw new Error("invalid web_search_sources entry");
    const row = item as Record<string, unknown>;
    const title = typeof row.title === "string" ? row.title.trim() : "";
    const url = typeof row.url === "string" ? row.url.trim() : "";
    const snippet = typeof row.snippet === "string" ? row.snippet.trim() : "";
    if (!url) throw new Error("web_search_sources.url required");
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new Error("web_search_sources.url must be http(s)");
      }
    } catch {
      throw new Error("web_search_sources.url invalid");
    }
    if (title.length > MAX_SOURCE_FIELD_CHARS || snippet.length > MAX_SOURCE_FIELD_CHARS) {
      throw new Error("web_search_sources field too large");
    }
    // Provider text, so bounded rather than parsed: the value is only ever
    // shown back and compared, and an unparseable one must not fail the write.
    const publishedAt =
      typeof row.publishedAt === "string"
        ? row.publishedAt.trim().slice(0, MAX_PUBLISHED_AT_CHARS)
        : "";
    out.push({
      title: title || url,
      url,
      snippet: snippet.slice(0, MAX_SOURCE_FIELD_CHARS),
      ...(row.usedByModel === true ? { usedByModel: true } : row.usedByModel === false ? { usedByModel: false } : {}),
      ...(publishedAt ? { publishedAt } : {}),
    });
  }
  return out.length > 0 ? out : undefined;
}

function sanitizeDeepResearch(raw: unknown): ChatMessageDeepResearch | undefined {
  if (raw == null) return undefined;
  if (!raw || typeof raw !== "object") throw new Error("invalid deep_research");
  const row = raw as Record<string, unknown>;
  const runId = typeof row.runId === "string" ? row.runId.trim() : "";
  if (!runId) throw new Error("deep_research.runId required");
  const statusRaw = typeof row.status === "string" ? row.status : "completed";
  const allowed = new Set([
    "running",
    "awaiting_clarify",
    "completed",
    "failed",
    "cancelled",
  ]);
  const status = allowed.has(statusRaw)
    ? (statusRaw as ChatMessageDeepResearch["status"])
    : "completed";
  const eventsRaw = Array.isArray(row.events) ? row.events : [];
  const events = eventsRaw
    .filter((e): e is DeepResearchEvent => Boolean(e && typeof e === "object" && "type" in e))
    .slice(-MAX_DEEP_RESEARCH_EVENTS);
  const artifactIds = Array.isArray(row.artifactIds)
    ? row.artifactIds.filter((id): id is string => typeof id === "string").slice(0, 40)
    : undefined;
  let clarifyAnswers: Record<string, string> | undefined;
  if (row.clarifyAnswers && typeof row.clarifyAnswers === "object" && !Array.isArray(row.clarifyAnswers)) {
    clarifyAnswers = {};
    for (const [key, value] of Object.entries(row.clarifyAnswers as Record<string, unknown>)) {
      if (typeof key === "string" && typeof value === "string" && key.trim() && value.trim()) {
        clarifyAnswers[key.trim()] = value.trim().slice(0, 500);
      }
    }
    if (Object.keys(clarifyAnswers).length === 0) clarifyAnswers = undefined;
  }

  const MAX_ASSUMPTIONS = 8;
  const MAX_ASSUMPTION_CHARS = 200;
  const MAX_SCOPE_ITEMS = 12;
  const MAX_SUB_QUESTIONS = 12;
  const MAX_STRATEGY_ITEMS = 8;
  const MAX_PLAN_TEXT_CHARS = 300;

  const asStringList = (value: unknown, maxItems: number, maxChars: number): string[] =>
    Array.isArray(value)
      ? value
          .filter((item): item is string => typeof item === "string" && Boolean(item.trim()))
          .slice(0, maxItems)
          .map((item) => item.trim().slice(0, maxChars))
      : [];

  const sanitizePlanSnapshot = (
    value: unknown,
  ): ChatMessageDeepResearch["plan"] | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const plan = value as Record<string, unknown>;
    const objective = typeof plan.objective === "string" ? plan.objective.trim() : "";
    if (!objective) return undefined;
    const version =
      typeof plan.version === "number" && Number.isInteger(plan.version) && plan.version > 0
        ? Math.min(plan.version, 999)
        : 1;
    const subQuestions = Array.isArray(plan.subQuestions)
      ? plan.subQuestions
          .map((item, index) => {
            if (!item || typeof item !== "object") return null;
            const question = item as Record<string, unknown>;
            const title = typeof question.title === "string" ? question.title.trim() : "";
            if (!title) return null;
            return {
              id:
                typeof question.id === "string" && question.id.trim()
                  ? question.id.trim().slice(0, 40)
                  : `sq${index + 1}`,
              title: title.slice(0, MAX_PLAN_TEXT_CHARS),
              ...(typeof question.purpose === "string" && question.purpose.trim()
                ? { purpose: question.purpose.trim().slice(0, MAX_PLAN_TEXT_CHARS) }
                : {}),
            };
          })
          .filter((item): item is NonNullable<typeof item> => item != null)
          .slice(0, MAX_SUB_QUESTIONS)
      : [];
    return {
      version,
      objective: objective.slice(0, MAX_PLAN_TEXT_CHARS),
      scope: asStringList(plan.scope, MAX_SCOPE_ITEMS, MAX_PLAN_TEXT_CHARS),
      subQuestions,
      sourceStrategy: asStringList(plan.sourceStrategy, MAX_STRATEGY_ITEMS, MAX_PLAN_TEXT_CHARS),
      deliverables: asStringList(plan.deliverables, MAX_STRATEGY_ITEMS, MAX_PLAN_TEXT_CHARS),
      assumptions: asStringList(plan.assumptions, MAX_ASSUMPTIONS, MAX_ASSUMPTION_CHARS),
    };
  };

  const sanitizeProfile = (
    value: unknown,
  ): ChatMessageDeepResearch["profile"] | undefined => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const profile = value as Record<string, unknown>;
    const depth = profile.researchDepth;
    const mode = profile.clarifyMode;
    const visibility = profile.planVisibility;
    if (
      (depth !== "light" && depth !== "standard" && depth !== "deep") ||
      (mode !== "card" && mode !== "chat" && mode !== "none") ||
      (visibility !== "hidden" &&
        visibility !== "preview" &&
        visibility !== "editable" &&
        visibility !== "chat_editable")
    ) {
      return undefined;
    }
    const budget =
      profile.clarifyBudget && typeof profile.clarifyBudget === "object"
        ? (profile.clarifyBudget as Record<string, unknown>)
        : {};
    const maxRounds =
      typeof budget.maxRounds === "number" && Number.isInteger(budget.maxRounds)
        ? Math.min(Math.max(budget.maxRounds, 1), 3)
        : 3;
    return {
      researchDepth: depth,
      clarifyMode: mode,
      clarifyBudget: { maxRounds, allowMidRun: budget.allowMidRun !== false },
      planVisibility: visibility,
      assumptions: asStringList(profile.assumptions, MAX_ASSUMPTIONS, MAX_ASSUMPTION_CHARS),
    };
  };

  const profile = sanitizeProfile(row.profile);
  const plan = sanitizePlanSnapshot(row.plan);
  const planVersion =
    typeof row.planVersion === "number" && Number.isInteger(row.planVersion) && row.planVersion > 0
      ? Math.min(row.planVersion, 999)
      : undefined;
  const assumptions = asStringList(row.assumptions, MAX_ASSUMPTIONS, MAX_ASSUMPTION_CHARS);

  return {
    runId,
    status,
    events,
    artifactIds,
    clarifyAnswers,
    ...(profile ? { profile } : {}),
    ...(plan ? { plan } : {}),
    ...(planVersion ? { planVersion } : {}),
    ...(assumptions.length > 0 ? { assumptions } : {}),
  };
}

export function sanitizeInboundMessages(
  sessionId: string,
  tenantId: string,
  userId: string,
  raw: unknown,
): ChatMessage[] {
  if (!Array.isArray(raw)) throw new Error("messages must be an array");
  if (raw.length > MAX_MESSAGES_PER_WRITE) {
    throw new Error(`messages must be <= ${MAX_MESSAGES_PER_WRITE}`);
  }

  const out: ChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") throw new Error("invalid message entry");
    const row = item as Record<string, unknown>;
    const id = typeof row.id === "string" ? row.id.trim() : "";
    const role = typeof row.role === "string" ? row.role : "";
    const content = typeof row.content === "string" ? row.content : "";
    if (!id || !ULID_RE.test(id)) {
      throw new Error("invalid message id: must be a valid ULID");
    }
    if (!ALLOWED_ROLES.has(role)) throw new Error(`invalid role: ${role}`);
    const attachments = sanitizeAttachments(row.attachments);
    const webSearchSources = sanitizeWebSearchSources(row.web_search_sources);
    // Retrieval diagnostics are optional observability metadata. Malformed or
    // unknown versions are ignored so they can never reject an otherwise valid turn.
    const webSearchTrace = sanitizeWebSearchTrace(row.web_search_trace);
    const deepResearch = sanitizeDeepResearch(row.deep_research);
    if (role === "user" && !content.trim() && !attachments?.length) {
      throw new Error("message content required");
    }
    if (content.length > MAX_MESSAGE_CONTENT_CHARS) throw new Error("message content too large");
    const createdAt = typeof row.created_at === "string" ? row.created_at : new Date().toISOString();
    if (Number.isNaN(Date.parse(createdAt))) throw new Error("invalid created_at");
    const model = typeof row.model === "string" ? row.model : undefined;
    // 只接受合法 26 位 ULID，拒绝伪造/超长输入；非法值静默丢弃而非抛错，
    // 避免旧客户端或脏数据把整批消息的落库打挂。
    const traceIdRaw = typeof row.trace_id === "string" ? row.trace_id.trim() : "";
    const traceId = isTraceId(traceIdRaw) ? traceIdRaw : undefined;
    out.push({
      id,
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: role as ChatMessage["role"],
      content,
      attachments,
      web_search_sources: webSearchSources,
      web_search_trace: webSearchTrace,
      deep_research: deepResearch,
      model,
      trace_id: traceId,
      created_at: createdAt,
    });
  }
  return out;
}
