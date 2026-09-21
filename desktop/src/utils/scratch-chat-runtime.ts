/**
 * Isolated scratch-chat send + SSE. Never writes pane.messages.
 *
 * Author: Damon Li
 */

import type { Message } from "../store";
import { sessionCreateAvatarId } from "./session-create-avatar";
import { parseSseFrame } from "./session-reattach";
import type { ScratchChat, ScratchChatContextFile } from "./scratch-chat";

export type ScratchChatCreateSession = (payload: {
  avatar_id?: string;
}) => Promise<{ ok: boolean; session_id?: string; error?: string }>;

export type ScratchChatReader = {
  read(): Promise<{ done: boolean; value?: Uint8Array }>;
};

export type ScratchChatTransport = {
  createSession: ScratchChatCreateSession;
  chat: (args: {
    apiBase: string;
    apiToken: string;
    body: Record<string, unknown>;
    signal?: AbortSignal;
  }) => Promise<{
    ok: boolean;
    status: number;
    body: { getReader(): ScratchChatReader } | null;
  }>;
};

export function buildScratchChatRequestBody(input: {
  sessionId: string;
  userInput: string;
  provider?: string;
  model?: string;
  quotedContent?: string;
  contextFiles?: ScratchChatContextFile[];
  clientTurnId: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    session_id: String(input.sessionId ?? "").trim(),
    user_input: String(input.userInput ?? ""),
    client_turn_id: String(input.clientTurnId ?? "").trim(),
  };
  const quoted = String(input.quotedContent ?? "").trim();
  if (quoted) body.quoted_content = quoted;
  const provider = String(input.provider ?? "").trim();
  const model = String(input.model ?? "").trim();
  if (provider) body.provider = provider;
  if (model) body.model = model;
  const files = input.contextFiles ?? [];
  if (files.length > 0) {
    const contextFiles: Record<string, string> = {};
    for (const file of files) {
      const key = String(file.sourcePath || file.path || "").trim();
      if (key) contextFiles[key] = "";
    }
    if (Object.keys(contextFiles).length > 0) body.context_files = contextFiles;
  }
  return body;
}

export function appendScratchTurn(
  messages: Message[],
  input: { userId: string; assistantId: string; text: string; sessionId: string },
): Message[] {
  const now = Date.now();
  return [
    ...messages,
    {
      id: input.userId,
      role: "user",
      content: input.text,
      ownerSessionId: input.sessionId,
      timestamp: now,
    },
    {
      id: input.assistantId,
      role: "assistant",
      content: "",
      ownerSessionId: input.sessionId,
      timestamp: now,
    },
  ];
}

function sseData(payload: Record<string, unknown>): Record<string, unknown> {
  return payload.data && typeof payload.data === "object"
    ? (payload.data as Record<string, unknown>)
    : {};
}

export function applyScratchSsePayload(
  messages: Message[],
  assistantId: string,
  payload: unknown,
): { messages: Message[]; done?: boolean; error?: string } {
  if (!payload || typeof payload !== "object") return { messages };
  const row = payload as Record<string, unknown>;
  const type = String(row.type ?? "");
  const data = sseData(row);

  if (type === "token") {
    const delta = String(data.text ?? data.delta ?? "");
    if (!delta) return { messages };
    return {
      messages: messages.map((item) =>
        item.id === assistantId ? { ...item, content: `${item.content}${delta}` } : item,
      ),
    };
  }
  if (type === "final") {
    const text = String(data.text ?? data.content ?? "").trim();
    return {
      messages: messages.map((item) =>
        item.id === assistantId ? { ...item, content: text || item.content } : item,
      ),
      done: true,
    };
  }
  if (type === "error") {
    return {
      messages,
      error: String(data.text ?? data.error ?? row.error ?? "unknown chat error"),
    };
  }
  if (type === "done") return { messages, done: true };
  return { messages };
}

export async function ensureScratchSessionId(input: {
  sessionId: string;
  avatarId: string | null | undefined;
  createSession: ScratchChatCreateSession;
}): Promise<string> {
  const existing = String(input.sessionId ?? "").trim();
  if (existing) return existing;
  const created = await input.createSession({
    avatar_id: sessionCreateAvatarId(input.avatarId),
  });
  const next = String(created.session_id ?? "").trim();
  if (!created.ok || !next) {
    throw new Error(created.error || "createSession failed");
  }
  return next;
}

export async function consumeScratchSse(
  reader: ScratchChatReader,
  onPayload: (payload: Record<string, unknown>) => void,
): Promise<void> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const parsed = parseSseFrame(frame);
      if (!parsed.payload || typeof parsed.payload !== "object") continue;
      onPayload(parsed.payload as Record<string, unknown>);
    }
  }
  if (buffer.trim()) {
    const parsed = parseSseFrame(buffer);
    if (parsed.payload && typeof parsed.payload === "object") {
      onPayload(parsed.payload as Record<string, unknown>);
    }
  }
}

export const defaultScratchChatTransport: ScratchChatTransport = {
  createSession: (payload) => {
    if (!window.agenticxDesktop?.createSession) {
      return Promise.resolve({ ok: false, error: "createSession unavailable" });
    }
    return window.agenticxDesktop.createSession(payload);
  },
  chat: async ({ apiBase, apiToken, body, signal }) => {
    const resp = await fetch(`${apiBase.replace(/\/$/, "")}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-agx-desktop-token": apiToken,
      },
      body: JSON.stringify(body),
      signal,
    });
    return { ok: resp.ok, status: resp.status, body: resp.body };
  },
};

export async function runScratchChatTurn(opts: {
  chat: ScratchChat;
  userText: string;
  paneAvatarId: string | null;
  provider?: string;
  model?: string;
  apiBase: string;
  apiToken: string;
  ids: { userId: string; assistantId: string; clientTurnId: string };
  transport: ScratchChatTransport;
  signal?: AbortSignal;
  onMessages: (messages: Message[]) => void;
  onSessionId: (sessionId: string) => void;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const userText = String(opts.userText ?? "").trim();
  if (!userText) return { ok: false, error: "empty" };

  let sessionId: string;
  try {
    sessionId = await ensureScratchSessionId({
      sessionId: opts.chat.sessionId,
      avatarId: opts.paneAvatarId,
      createSession: opts.transport.createSession,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  opts.onSessionId(sessionId);

  let resp: Awaited<ReturnType<ScratchChatTransport["chat"]>>;
  try {
    resp = await opts.transport.chat({
      apiBase: opts.apiBase,
      apiToken: opts.apiToken,
      body: buildScratchChatRequestBody({
        sessionId,
        userInput: userText,
        provider: opts.provider,
        model: opts.model,
        quotedContent: opts.chat.quotedContent,
        contextFiles: opts.chat.contextFiles,
        clientTurnId: opts.ids.clientTurnId,
      }),
      signal: opts.signal,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!resp.ok || !resp.body) {
    return { ok: false, error: `HTTP ${resp.status}` };
  }

  let messages = appendScratchTurn(opts.chat.messages ?? [], {
    userId: opts.ids.userId,
    assistantId: opts.ids.assistantId,
    text: userText,
    sessionId,
  });
  opts.onMessages(messages);

  try {
    await consumeScratchSse(resp.body.getReader(), (payload) => {
      const next = applyScratchSsePayload(messages, opts.ids.assistantId, payload);
      messages = next.messages;
      opts.onMessages(messages);
      if (next.error) throw new Error(next.error);
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true };
}
