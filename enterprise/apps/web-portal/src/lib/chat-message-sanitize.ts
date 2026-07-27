import type { ChatMessage, ChatMessageAttachment, WebSearchSource } from "@agenticx/core-api";

const ALLOWED_ROLES = new Set(["system", "user", "assistant", "tool"]);
export const MAX_MESSAGES_PER_WRITE = 100;
export const MAX_MESSAGE_CONTENT_CHARS = 128_000;
export const MAX_IMAGE_ATTACHMENTS = 4;
/** Base64 data URLs for up to ~5MB images. */
export const MAX_ATTACHMENT_DATA_URL_CHARS = 8_000_000;
export const MAX_WEB_SEARCH_SOURCES = 50;
export const MAX_SOURCE_FIELD_CHARS = 4_000;

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
    if (!name) throw new Error("attachment name required");
    if (!mimeType.startsWith("image/")) throw new Error("attachment mime_type must be image/*");
    if (!dataUrl.startsWith("data:image/")) throw new Error("attachment data_url must be image data URL");
    if (dataUrl.length > MAX_ATTACHMENT_DATA_URL_CHARS) throw new Error("attachment data_url too large");
    const size = typeof row.size === "number" && Number.isFinite(row.size) ? row.size : undefined;
    out.push({
      name,
      mime_type: mimeType,
      size,
      data_url: dataUrl,
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
    });
  }
  return out.length > 0 ? out : undefined;
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
    const id = typeof row.id === "string" ? row.id : "";
    const role = typeof row.role === "string" ? row.role : "";
    const content = typeof row.content === "string" ? row.content : "";
    if (!ALLOWED_ROLES.has(role)) throw new Error(`invalid role: ${role}`);
    const attachments = sanitizeAttachments(row.attachments);
    const webSearchSources = sanitizeWebSearchSources(row.web_search_sources);
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
      model,
      created_at: createdAt,
    });
  }
  return out;
}
