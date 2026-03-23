import type { Message, MessageAttachment, MsgRole } from "../store";

/** Snapshot row from GET /api/session/messages (snake_case). */
export function attachmentsFromSessionRow(raw: unknown): MessageAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: MessageAttachment[] = [];
  for (const a of raw) {
    if (!a || typeof a !== "object") continue;
    const o = a as { name?: unknown; mime_type?: unknown; size?: unknown; data_url?: unknown };
    const dataUrl = String(o.data_url ?? "").trim();
    if (!dataUrl.startsWith("data:image/")) continue;
    const name = String(o.name ?? "").trim() || "image";
    const mimeType = String(o.mime_type ?? "").trim() || "image/png";
    const sizeRaw = o.size;
    const size = typeof sizeRaw === "number" && Number.isFinite(sizeRaw) ? sizeRaw : Number(sizeRaw) || 0;
    out.push({ name, mimeType, size, dataUrl });
  }
  return out.length ? out : undefined;
}

export type LoadedSessionMessage = {
  id?: string;
  role: MsgRole;
  content: string;
  agent_id?: string;
  avatar_name?: string;
  avatar_url?: string;
  provider?: string;
  model?: string;
  quoted_message_id?: string;
  quoted_content?: string;
  timestamp?: number;
  forwarded_history?: {
    title?: string;
    source_session?: string;
    items?: Array<{
      sender?: string;
      role?: string;
      content?: string;
      avatar_url?: string;
      timestamp?: number;
    }>;
  };
  /** From messages.json / GET /api/session/messages */
  attachments?: unknown;
};

export function mapLoadedSessionMessage(item: LoadedSessionMessage, idPrefix: string, index: number): Message {
  const forwarded = item.forwarded_history;
  const forwardedItems = Array.isArray(forwarded?.items)
    ? forwarded.items
        .filter((entry) => entry && typeof entry === "object")
        .map((entry) => ({
          sender: String(entry.sender || "").trim() || "unknown",
          role: String(entry.role || "").trim() || "assistant",
          content: String(entry.content || ""),
          avatarUrl: String(entry.avatar_url || "").trim() || undefined,
          timestamp: typeof entry.timestamp === "number" ? entry.timestamp : undefined,
        }))
    : [];
  const storedId = item.id != null ? String(item.id).trim() : "";
  const id = `${idPrefix}-i${index}${storedId ? `-${storedId}` : ""}`;
  return {
    id,
    role: item.role,
    content: item.content,
    agentId: item.agent_id ?? "meta",
    avatarName: item.avatar_name,
    avatarUrl: item.avatar_url,
    provider: item.provider,
    model: item.model,
    quotedMessageId: item.quoted_message_id,
    quotedContent: item.quoted_content,
    timestamp: typeof item.timestamp === "number" ? item.timestamp : undefined,
    forwardedHistory:
      forwarded && forwardedItems.length > 0
        ? {
            title: String(forwarded.title || "").trim() || "聊天记录",
            sourceSession: String(forwarded.source_session || "").trim(),
            items: forwardedItems,
          }
        : undefined,
    attachments: attachmentsFromSessionRow(item.attachments),
  };
}
