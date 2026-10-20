/**
 * Client contract for per-message chat feedback.
 *
 * Feedback is intentionally kept outside the message payload.  The server
 * owns the durable record and the client only keeps the latest value for the
 * current user/message pair. The portal uses the same-origin cookie route.
 * The narrow base/path options leave room for a future authenticated host
 * without allowing credentials to be redirected to an arbitrary URL.
 */

export type ChatFeedbackValue = "like" | "dislike";

export type ChatMessageFeedback = {
  message_id: string;
  session_id: string;
  value: ChatFeedbackValue;
  created_at?: string;
  updated_at?: string;
};

export type ChatFeedbackByMessageId = Record<string, ChatFeedbackValue>;

export type ChatFeedbackClientOptions = {
  /** Optional origin for another authenticated host; the portal leaves this unset. */
  baseUrl?: string;
  /**
   * Same-origin API path. Absolute URLs and protocol-relative paths are
   * rejected so a caller cannot redirect feedback credentials to another
   * host by accident. The portal defaults to the cookie route.
   */
  path?: string;
  /** Optional request headers for an authenticated host. */
  headers?: HeadersInit;
  /** Injectable for deterministic tests. */
  fetchImpl?: typeof fetch;
};

export type ChatFeedbackClient = {
  list(sessionId: string): Promise<ChatFeedbackByMessageId>;
  set(input: {
    sessionId: string;
    messageId: string;
    value: ChatFeedbackValue;
  }): Promise<ChatMessageFeedback>;
  clear(input: { sessionId: string; messageId: string }): Promise<void>;
};

const FEEDBACK_PATH = "/api/chat/feedback";

function cleanPart(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizePath(rawPath: string | undefined): string {
  const path = cleanPart(rawPath) || FEEDBACK_PATH;
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("://")) {
    throw new Error("反馈 API 路径必须是安全的相对路径");
  }
  const parsed = new URL(path, "http://agenticx-feedback.invalid");
  if (parsed.origin !== "http://agenticx-feedback.invalid" || parsed.search || parsed.hash) {
    throw new Error("反馈 API 路径必须是安全的相对路径");
  }
  return parsed.pathname;
}

function endpoint(baseUrl: string | undefined, path: string, query?: URLSearchParams): string {
  const base = cleanPart(baseUrl);
  const target = query && query.size > 0 ? `${path}?${query.toString()}` : path;
  if (!base) return target;
  return `${base.replace(/\/+$/, "")}${target}`;
}

function isFeedbackValue(value: unknown): value is ChatFeedbackValue {
  return value === "like" || value === "dislike";
}

function responseError(raw: unknown, fallback: string): string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fallback;
  const row = raw as Record<string, unknown>;
  const nested = row.error;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const message = (nested as Record<string, unknown>).message;
    if (typeof message === "string" && message.trim()) return message.trim();
  }
  const message = row.message;
  return typeof message === "string" && message.trim() ? message.trim() : fallback;
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

function toFeedbackRecord(raw: unknown): ChatMessageFeedback | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const messageId = cleanPart(String(row.message_id ?? row.messageId ?? ""));
  const sessionId = cleanPart(String(row.session_id ?? row.sessionId ?? ""));
  const value = row.value ?? row.feedback ?? row.type;
  if (!messageId || !sessionId || !isFeedbackValue(value)) return null;
  return {
    message_id: messageId,
    session_id: sessionId,
    value,
    ...(typeof row.created_at === "string" ? { created_at: row.created_at } : {}),
    ...(typeof row.updated_at === "string" ? { updated_at: row.updated_at } : {}),
  };
}

function extractFeedbackRows(payload: unknown): unknown[] {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return [];
  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? (root.data as Record<string, unknown>)
    : root;
  const rows = data.feedback ?? data.items ?? data.records;
  return Array.isArray(rows) ? rows : [];
}

function toFeedbackMap(payload: unknown): ChatFeedbackByMessageId {
  const result: ChatFeedbackByMessageId = {};
  for (const raw of extractFeedbackRows(payload)) {
    const record = toFeedbackRecord(raw);
    if (record) result[record.message_id] = record.value;
  }
  return result;
}

function extractFeedbackRecord(payload: unknown): ChatMessageFeedback | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const root = payload as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" && !Array.isArray(root.data)
    ? (root.data as Record<string, unknown>)
    : root;
  return toFeedbackRecord(data.feedback ?? data.record ?? data);
}

function makeHeaders(extra: HeadersInit | undefined, includeJson = false): Headers {
  const headers = new Headers(extra);
  if (includeJson) headers.set("content-type", "application/json");
  headers.set("accept", "application/json");
  return headers;
}

async function ensureOk(response: Response, fallback: string): Promise<unknown> {
  const payload = await readJson(response);
  if (!response.ok) {
    throw new Error(responseError(payload, `${fallback}（HTTP ${response.status}）`));
  }
  return payload;
}

export function createChatFeedbackClient(options: ChatFeedbackClientOptions = {}): ChatFeedbackClient {
  const fetchImpl = options.fetchImpl ?? fetch;
  const baseUrl = options.baseUrl;
  const headers = options.headers;
  const path = normalizePath(options.path);
  return {
    async list(sessionId) {
      const sid = cleanPart(sessionId);
      if (!sid) return {};
      const query = new URLSearchParams({ session_id: sid });
      const response = await fetchImpl(endpoint(baseUrl, path, query), {
        method: "GET",
        headers: makeHeaders(headers),
        credentials: baseUrl ? "omit" : "same-origin",
        cache: "no-store",
      });
      const payload = await ensureOk(response, "读取反馈失败");
      return toFeedbackMap(payload);
    },

    async set(input) {
      const sessionId = cleanPart(input.sessionId);
      const messageId = cleanPart(input.messageId);
      if (!sessionId || !messageId || !isFeedbackValue(input.value)) {
        throw new Error("反馈参数不完整");
      }
      const response = await fetchImpl(endpoint(baseUrl, path), {
        method: "PUT",
        headers: makeHeaders(headers, true),
        credentials: baseUrl ? "omit" : "same-origin",
        body: JSON.stringify({
          session_id: sessionId,
          message_id: messageId,
          value: input.value,
        }),
      });
      const payload = await ensureOk(response, "保存反馈失败");
      const record = extractFeedbackRecord(payload);
      if (!record) {
        throw new Error("保存反馈失败：服务端返回数据不完整");
      }
      return record;
    },

    async clear(input) {
      const sessionId = cleanPart(input.sessionId);
      const messageId = cleanPart(input.messageId);
      if (!sessionId || !messageId) throw new Error("反馈参数不完整");
      const response = await fetchImpl(endpoint(baseUrl, path), {
        method: "DELETE",
        headers: makeHeaders(headers, true),
        credentials: baseUrl ? "omit" : "same-origin",
        body: JSON.stringify({ session_id: sessionId, message_id: messageId }),
      });
      await ensureOk(response, "取消反馈失败");
    },
  };
}

/** Portal default: same-origin cookie auth. */
export function createPortalChatFeedbackClient(): ChatFeedbackClient {
  return createChatFeedbackClient();
}

/**
 * Parse a server list response in tests or callers that already fetched it.
 * Kept public so a future bootstrap endpoint can hydrate without coupling UI
 * to the wire envelope.
 */
export function parseChatFeedbackMap(payload: unknown): ChatFeedbackByMessageId {
  return toFeedbackMap(payload);
}
