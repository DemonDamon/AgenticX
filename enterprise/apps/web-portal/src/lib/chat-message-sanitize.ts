import type {
  ChatMessage,
  ChatMessageAttachment,
  ChatMessageDeepResearch,
  DeepResearchEvent,
  WebSearchSource,
} from "@agenticx/core-api";

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
    out.push({
      title: title || url,
      url,
      snippet: snippet.slice(0, MAX_SOURCE_FIELD_CHARS),
      ...(row.usedByModel === true ? { usedByModel: true } : row.usedByModel === false ? { usedByModel: false } : {}),
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
  return { runId, status, events, artifactIds, clarifyAnswers };
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
    const deepResearch = sanitizeDeepResearch(row.deep_research);
    if (role === "user" && !content.trim() && !attachments?.length) {
      throw new Error("message content required");
    }
    if (content.length > MAX_MESSAGE_CONTENT_CHARS) throw new Error("message content too large");
    const createdAt = typeof row.created_at === "string" ? row.created_at : new Date().toISOString();
    if (Number.isNaN(Date.parse(createdAt))) throw new Error("invalid created_at");
    const model = typeof row.model === "string" ? row.model : undefined;
    out.push({
      id,
      session_id: sessionId,
      tenant_id: tenantId,
      user_id: userId,
      role: role as ChatMessage["role"],
      content,
      attachments,
      web_search_sources: webSearchSources,
      deep_research: deepResearch,
      model,
      created_at: createdAt,
    });
  }
  return out;
}
