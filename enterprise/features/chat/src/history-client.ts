import type { ChatMessage, ChatSession } from "@agenticx/core-api";
import { normalizeTransportErrorMessage } from "@agenticx/sdk-ts";

const BASE = "/api/chat/sessions";

export class ChatHistoryHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ChatHistoryHttpError";
    this.status = status;
  }
}

async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  let message = res.statusText;
  try {
    const raw = await res.text();
    if (raw) {
      const parsed = JSON.parse(raw) as { error?: { message?: string }; message?: string };
      if (parsed.error?.message) message = parsed.error.message;
      else if (parsed.message) message = parsed.message;
    }
  } catch {
    // keep statusText
  }
  throw new ChatHistoryHttpError(
    normalizeTransportErrorMessage(message || `request failed: ${res.status}`),
    res.status,
  );
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status === 502 || status === 503 || status === 504;
}

function isRetryableTransportError(error: unknown): boolean {
  if (error instanceof ChatHistoryHttpError) {
    return isRetryableStatus(error.status);
  }
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return false;
  const lower = error.message.toLowerCase();
  return (
    lower === "failed to fetch" ||
    lower === "network error" ||
    lower.includes("networkerror") ||
    lower === "load failed" ||
    lower.includes("fetch failed") ||
    lower.includes("econnreset") ||
    lower.includes("econnrefused") ||
    lower.includes("socket hang up")
  );
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(attempt: number, res?: Response): number {
  const retryAfter = res?.headers.get("Retry-After");
  if (retryAfter) {
    const asNumber = Number(retryAfter);
    if (Number.isFinite(asNumber) && asNumber >= 0) {
      return Math.min(10_000, asNumber * 1000);
    }
    const asDate = Date.parse(retryAfter);
    if (Number.isFinite(asDate)) {
      return Math.min(10_000, Math.max(0, asDate - Date.now()));
    }
  }
  return Math.min(2000, 200 * 2 ** attempt);
}

/**
 * History writes often run immediately after a long SSE completion.
 * Dev servers / local proxies intermittently drop that follow-up POST
 * as TypeError: Failed to fetch — retry before surfacing to the user.
 */
export async function historyFetch(
  input: string,
  init?: RequestInit,
  options?: { retries?: number },
): Promise<Response> {
  const retries = Math.max(0, options?.retries ?? 2);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(input, {
        ...init,
        credentials: init?.credentials ?? "same-origin",
      });
    } catch (error) {
      lastError = error;
      if (attempt >= retries || !isRetryableTransportError(error)) {
        const raw = error instanceof Error ? error.message : "request failed";
        throw new Error(normalizeTransportErrorMessage(raw));
      }
      await sleep(120 * 2 ** attempt);
    }
  }
  const raw = lastError instanceof Error ? lastError.message : "request failed";
  throw new Error(normalizeTransportErrorMessage(raw));
}

/**
 * Unified history HTTP helper: transport retries + HTTP 408/429/5xx retries
 * happen inside the same loop (unlike historyFetch + ensureOk outside).
 */
export async function historyRequest(
  input: string,
  init?: RequestInit,
  options?: { retries?: number },
): Promise<Response> {
  const retries = Math.max(0, options?.retries ?? 2);
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const res = await fetch(input, {
        ...init,
        credentials: init?.credentials ?? "same-origin",
      });
      if (res.ok) return res;
      if (isRetryableStatus(res.status) && attempt < retries) {
        await res.text().catch(() => undefined);
        await sleep(retryDelayMs(attempt, res));
        continue;
      }
      await ensureOk(res);
      return res;
    } catch (error) {
      lastError = error;
      if (error instanceof ChatHistoryHttpError) throw error;
      if (attempt >= retries || !isRetryableTransportError(error)) {
        const raw = error instanceof Error ? error.message : "request failed";
        throw new Error(normalizeTransportErrorMessage(raw));
      }
      await sleep(retryDelayMs(attempt));
    }
  }
  const raw = lastError instanceof Error ? lastError.message : "request failed";
  throw new Error(normalizeTransportErrorMessage(raw));
}

export type AppendMessagesOptions = {
  operationId?: string;
  payloadHash?: string;
  retries?: number;
};

export type PortalChatHistoryClient = {
  listSessions(): Promise<ChatSession[]>;
  createSession(input: { title: string; activeModel?: string }): Promise<ChatSession>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
  appendMessages(
    sessionId: string,
    messages: ChatMessage[] | Array<Record<string, unknown>>,
    options?: AppendMessagesOptions,
  ): Promise<void>;
  replaceMessages(sessionId: string, messages: ChatMessage[]): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<ChatSession>;
  patchSession(
    sessionId: string,
    patch: { title?: string; activeModel?: string | null; pinned?: boolean },
  ): Promise<ChatSession>;
  pinSession(sessionId: string, pinned: boolean): Promise<ChatSession>;
  deleteSession(sessionId: string): Promise<void>;
  deleteSessions(sessionIds: string[]): Promise<number>;
};

export function createPortalChatHistoryClient(): PortalChatHistoryClient {
  return {
    async listSessions() {
      const res = await historyRequest(BASE, { cache: "no-store" });
      const json = (await res.json()) as { data?: { sessions?: ChatSession[] } };
      return json.data?.sessions ?? [];
    },

    async createSession(input) {
      const res = await historyRequest(BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          active_model: input.activeModel,
        }),
      });
      const json = (await res.json()) as { data?: { session?: ChatSession } };
      if (!json.data?.session) throw new Error("missing session in response");
      return json.data.session;
    },

    async getMessages(sessionId) {
      const res = await historyRequest(`${BASE}/${encodeURIComponent(sessionId)}/messages`, {
        cache: "no-store",
      });
      const json = (await res.json()) as { data?: { messages?: ChatMessage[] } };
      return json.data?.messages ?? [];
    },

    async appendMessages(sessionId, messages, options) {
      const body: Record<string, unknown> = { messages, replace_all: false };
      if (options?.operationId) body.operation_id = options.operationId;
      if (options?.payloadHash) body.payload_hash = options.payloadHash;
      await historyRequest(
        `${BASE}/${encodeURIComponent(sessionId)}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
        { retries: options?.retries ?? 5 },
      );
    },

    async replaceMessages(sessionId, messages) {
      await historyRequest(
        `${BASE}/${encodeURIComponent(sessionId)}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages, replace_all: true }),
        },
        { retries: 3 },
      );
    },

    async renameSession(sessionId, title) {
      const res = await historyRequest(`${BASE}/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      const json = (await res.json()) as { data?: { session?: ChatSession } };
      if (!json.data?.session) throw new Error("missing session in response");
      return json.data.session;
    },

    async patchSession(sessionId, patch) {
      const body: { title?: string; active_model?: string | null; pinned?: boolean } = {};
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.activeModel !== undefined) body.active_model = patch.activeModel;
      if (patch.pinned !== undefined) body.pinned = patch.pinned;
      const res = await historyRequest(`${BASE}/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as { data?: { session?: ChatSession } };
      if (!json.data?.session) throw new Error("missing session in response");
      return json.data.session;
    },

    async pinSession(sessionId, pinned) {
      const res = await historyRequest(`${BASE}/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      const json = (await res.json()) as { data?: { session?: ChatSession } };
      if (!json.data?.session) throw new Error("missing session in response");
      return json.data.session;
    },

    async deleteSession(sessionId) {
      await historyRequest(`${BASE}/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
    },

    async deleteSessions(sessionIds) {
      const res = await historyRequest(`${BASE}/batch-delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_ids: sessionIds }),
      });
      const json = (await res.json()) as { data?: { deleted?: number } };
      return Number(json.data?.deleted ?? 0);
    },
  };
}
