import type { ChatMessage, ChatSession } from "@agenticx/core-api";

const BASE = "/api/chat/sessions";

async function ensureOk(res: Response): Promise<void> {
  if (res.ok) return;
  let message = res.statusText;
  try {
    const raw = await res.text();
    if (raw) {
      const parsed = JSON.parse(raw) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    }
  } catch {
    // keep statusText
  }
  throw new Error(message || `request failed: ${res.status}`);
}

export type PortalChatHistoryClient = {
  listSessions(): Promise<ChatSession[]>;
  createSession(input: { title: string; activeModel?: string }): Promise<ChatSession>;
  getMessages(sessionId: string): Promise<ChatMessage[]>;
  appendMessages(sessionId: string, messages: ChatMessage[]): Promise<void>;
  replaceMessages(sessionId: string, messages: ChatMessage[]): Promise<void>;
  renameSession(sessionId: string, title: string): Promise<ChatSession>;
  patchSession(sessionId: string, patch: { title?: string; activeModel?: string | null }): Promise<ChatSession>;
  deleteSession(sessionId: string): Promise<void>;
};

export function createPortalChatHistoryClient(): PortalChatHistoryClient {
  return {
    async listSessions() {
      const res = await fetch(BASE, { cache: "no-store", credentials: "same-origin" });
      await ensureOk(res);
      const json = (await res.json()) as { data?: { sessions?: ChatSession[] } };
      return json.data?.sessions ?? [];
    },

    async createSession(input) {
      const res = await fetch(BASE, {
        method: "POST",
        credentials: "same-origin",
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
      const res = await fetch(`${BASE}/${encodeURIComponent(sessionId)}/messages`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      await ensureOk(res);
      const json = (await res.json()) as { data?: { messages?: ChatMessage[] } };
      return json.data?.messages ?? [];
    },

    async appendMessages(sessionId, messages) {
      const res = await fetch(`${BASE}/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages, replace_all: false }),
      });
      await ensureOk(res);
    },

    async replaceMessages(sessionId, messages) {
      const res = await fetch(`${BASE}/${encodeURIComponent(sessionId)}/messages`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages, replace_all: true }),
      });
      await ensureOk(res);
    },

    async renameSession(sessionId, title) {
      const res = await fetch(`${BASE}/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      });
      await ensureOk(res);
      const json = (await res.json()) as { data?: { session?: ChatSession } };
      if (!json.data?.session) throw new Error("missing session in response");
      return json.data.session;
    },

    async patchSession(sessionId, patch) {
      const body: { title?: string; active_model?: string | null } = {};
      if (patch.title !== undefined) body.title = patch.title;
      if (patch.activeModel !== undefined) body.active_model = patch.activeModel;
      const res = await fetch(`${BASE}/${encodeURIComponent(sessionId)}`, {
        method: "PATCH",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      await ensureOk(res);
      const json = (await res.json()) as { data?: { session?: ChatSession } };
      if (!json.data?.session) throw new Error("missing session in response");
      return json.data.session;
    },

    async deleteSession(sessionId) {
      const res = await fetch(`${BASE}/${encodeURIComponent(sessionId)}`, {
        method: "DELETE",
        credentials: "same-origin",
      });
      await ensureOk(res);
    },
  };
}
