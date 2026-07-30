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

function isRetryableTransportError(error: unknown): boolean {
  if (error instanceof ChatHistoryHttpError) {
    return error.status === 502 || error.status === 503 || error.status === 504;
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

export type PortalChatHistoryClient = {
  listSessions(): Promise<ChatSession[]>;
  createSession(input: { title: string; activeModel?: string }): Promise<ChatSession>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
  appendMessages(sessionId: string, messages: ChatMessage[]): Promise<void>;
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
      const res = await historyFetch(BASE, { cache: "no-store" });
      await ensureOk(res);
      const json = (await res.json()) as { data?: { sessions?: ChatSession[] } };
      return json.data?.sessions ?? [];
    },

    async createSession(input) {
      const res = await historyFetch(BASE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: input.title,
          active_model: input.activeModel,
        }),
      });
      await ensureOk(res);
      const json = (await res.json()) as { data?: { session?: ChatSession } };
      if (!json.data?.session) throw new Error("missing session in response");
      return json.data.session;
    },

    async getMessages(sessionId) {
      const res = await historyFetch(`${BASE}/${encodeURIComponent(sessionId)}/messages`, {
        cache: "no-store",
      });
      await ensureOk(res);
      const json = (await res.json()) as { data?: { messages?: ChatMessage[] } };
      return json.data?.messages ?? [];
    },

    async appendMessages(sessionId, messages) {
      const res = await historyFetch(
        `${BASE}/${encodeURIComponent(sessionId)}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages, replace_all: false }),
        },
        // Persist right after SSE is the flakiest path — give it one extra retry.
        { retries: 3 },
      );
      await ensureOk(res);
    },

    async replaceMessages(sessionId, messages) {
      const res = await historyFetch(
        `${BASE}/${encodeURIComponent(sessionId)}/messages`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ messages, replace_all: true }),
        },
        { retries: 3 },
      );
      await ensureOk(res);
    },

    async renameSession(sessionId, title) {
      const res = await historyFetch(`${BASE}/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      await ensureOk(res);
      const json = (await res.json()) as { data?: { session?: ChatSession } };
      if (!json.data?.session) throw new Error("missing session in response");
      return json.data.session;
    },

    async patchSession(sessionId, patch) {
      const body: { title?: string; active_model?: string | null; pinned?: boolean } = {};
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.activeModel !== undefined) body.active_model = patch.activeModel;
      if (patch.pinned !== undefined) body.pinned = patch.pinned;
      const res = await historyFetch(`${BASE}/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await ensureOk(res);
      const json = (await res.json()) as { data?: { session?: ChatSession } };
      if (!json.data?.session) throw new Error("missing session in response");
      return json.data.session;
    },

    async pinSession(sessionId, pinned) {
      const res = await historyFetch(`${BASE}/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pinned }),
      });
      await ensureOk(res);
      const json = (await res.json()) as { data?: { session?: ChatSession } };
      if (!json.data?.session) throw new Error("missing session in response");
      return json.data.session;
    },

    async deleteSession(sessionId) {
      const res = await historyFetch(`${BASE}/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
      });
      await ensureOk(res);
    },

    async deleteSessions(sessionIds) {
      const res = await historyFetch(`${BASE}/batch-delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_ids: sessionIds }),
      });
      await ensureOk(res);
      const json = (await res.json()) as { data?: { deleted?: number } };
      return Number(json.data?.deleted ?? 0);
    },
  };
}
