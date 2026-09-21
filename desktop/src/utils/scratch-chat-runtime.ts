/**
 * Isolated scratch-chat send + SSE. Never writes pane.messages.
 *
 * Author: Damon Li
 */

import type { Message, ToolCallStatus } from "../store";
import { sessionCreateAvatarId } from "./session-create-avatar";
import { parseSseFrame } from "./session-reattach";
import type { ScratchChat, ScratchChatContextFile } from "./scratch-chat";

const SILENT_SCRATCH_TOOLS = new Set(["check_resources"]);

export function isScratchAbortError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return String((err as { name?: string }).name ?? "") === "AbortError";
}

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

export function scratchVisibleReplyText(content: string): string {
  return String(content ?? "")
    .replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "")
    .trim();
}

export function lastScratchUserMessage(messages: Message[]): Message | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i]?.role === "user") return messages[i];
  }
  return null;
}

export function isScratchReplyIncomplete(messages: Message[]): boolean {
  const user = lastScratchUserMessage(messages);
  if (!user) return false;
  const idx = messages.findIndex((item) => item.id === user.id);
  const after = idx >= 0 ? messages.slice(idx + 1) : [];
  const assistant = [...after].reverse().find((item) => item.role === "assistant");
  if (!assistant) return true;
  return !scratchVisibleReplyText(assistant.content);
}

export function prepareScratchRetry(
  messages: Message[],
  userId: string,
): { messages: Message[]; userText: string } | null {
  const idx = messages.findIndex((item) => item.id === userId && item.role === "user");
  if (idx < 0) return null;
  const userText = String(messages[idx]?.content ?? "").trim();
  if (!userText) return null;
  return { messages: messages.slice(0, idx + 1), userText };
}

function appendScratchAssistant(
  messages: Message[],
  input: { assistantId: string; sessionId: string },
): Message[] {
  return [
    ...messages,
    {
      id: input.assistantId,
      role: "assistant",
      content: "",
      ownerSessionId: input.sessionId,
      timestamp: Date.now(),
    },
  ];
}

function sseData(payload: Record<string, unknown>): Record<string, unknown> {
  return payload.data && typeof payload.data === "object"
    ? (payload.data as Record<string, unknown>)
    : {};
}

function scratchToolCallId(data: Record<string, unknown>): string {
  return String(data.tool_call_id ?? data.id ?? "").trim();
}

function scratchToolName(data: Record<string, unknown>): string {
  return String(data.name ?? data.tool ?? "tool").trim() || "tool";
}

function finishRunningScratchTools(messages: Message[], status: ToolCallStatus = "done"): Message[] {
  return messages.map((item) =>
    item.role === "tool" && (item.toolStatus === "running" || item.toolStatus === "pending")
      ? { ...item, toolStatus: status }
      : item,
  );
}

function upsertScratchToolMessage(
  messages: Message[],
  assistantId: string,
  patch: Partial<Message> & { toolCallId?: string; toolName?: string },
): Message[] {
  const callId = String(patch.toolCallId ?? "").trim();
  const existing = messages.findIndex(
    (item) => item.role === "tool" && callId && item.toolCallId === callId,
  );
  if (existing >= 0) {
    return messages.map((item, index) => (index === existing ? { ...item, ...patch } : item));
  }
  const tool: Message = {
    id: callId ? `scratch-tool:${callId}` : `scratch-tool:${assistantId}:${messages.length}`,
    role: "tool",
    content: "",
    timestamp: Date.now(),
    ...patch,
  };
  const assistantIdx = messages.findIndex((item) => item.id === assistantId);
  if (assistantIdx >= 0) {
    return [...messages.slice(0, assistantIdx), tool, ...messages.slice(assistantIdx)];
  }
  return [...messages, tool];
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
  if (type === "tool_call") {
    const name = scratchToolName(data);
    if (SILENT_SCRATCH_TOOLS.has(name)) return { messages };
    const callId = scratchToolCallId(data);
    const args = (data.arguments ?? data.args ?? {}) as Record<string, unknown>;
    return {
      messages: upsertScratchToolMessage(messages, assistantId, {
        toolCallId: callId || undefined,
        toolName: name,
        toolArgs: args && typeof args === "object" ? args : {},
        toolStatus: "running",
      }),
    };
  }
  if (type === "tool_progress") {
    const callId = scratchToolCallId(data);
    const preview = String(data.text ?? data.message ?? data.preview ?? "").trim();
    if (!callId && !preview) return { messages };
    return {
      messages: messages.map((item) => {
        if (item.role !== "tool") return item;
        if (callId && item.toolCallId !== callId) return item;
        if (!callId && item.toolStatus !== "running") return item;
        const lines = preview
          ? [...(item.toolStreamLines ?? []), preview].slice(-20)
          : item.toolStreamLines;
        return {
          ...item,
          toolStatus: "running",
          toolResultPreview: preview || item.toolResultPreview,
          toolStreamLines: lines,
        };
      }),
    };
  }
  if (type === "tool_result") {
    const name = scratchToolName(data);
    if (SILENT_SCRATCH_TOOLS.has(name)) return { messages };
    const callId = scratchToolCallId(data);
    const isError = data.is_error === true;
    const raw = data.result ?? data.content ?? data.text ?? "";
    const content = typeof raw === "string" ? raw : JSON.stringify(raw);
    const preview = content.replace(/\s+/g, " ").trim().slice(0, 160);
    const status: ToolCallStatus = isError ? "error" : "done";
    const matched = messages.some(
      (item) => item.role === "tool" && callId && item.toolCallId === callId,
    );
    if (matched || callId) {
      return {
        messages: upsertScratchToolMessage(messages, assistantId, {
          toolCallId: callId || undefined,
          toolName: name,
          content,
          toolStatus: status,
          toolResultPreview: preview,
          toolStreamLines: [],
        }),
      };
    }
    const fallback = [...messages]
      .reverse()
      .find(
        (item) =>
          item.role === "tool" &&
          (item.toolStatus === "running" || item.toolStatus === "pending") &&
          (!name || name === "tool" || item.toolName === name),
      );
    if (!fallback) {
      return {
        messages: upsertScratchToolMessage(messages, assistantId, {
          toolName: name,
          content,
          toolStatus: status,
          toolResultPreview: preview,
        }),
      };
    }
    return {
      messages: messages.map((item) =>
        item.id === fallback.id
          ? {
              ...item,
              content,
              toolStatus: status,
              toolResultPreview: preview,
              toolStreamLines: [],
            }
          : item,
      ),
    };
  }
  if (type === "final") {
    const text = String(data.text ?? data.content ?? "").trim();
    return {
      messages: finishRunningScratchTools(
        messages.map((item) =>
          item.id === assistantId ? { ...item, content: text || item.content } : item,
        ),
      ),
      done: true,
    };
  }
  if (type === "error") {
    return {
      messages: finishRunningScratchTools(messages, "error"),
      error: String(data.text ?? data.error ?? row.error ?? "unknown chat error"),
    };
  }
  if (type === "done") return { messages: finishRunningScratchTools(messages), done: true };
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

export type ScratchTurnResult =
  | { ok: true }
  | { ok: false; error: string; committed?: boolean };

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
  reuseUser?: boolean;
  onMessages: (messages: Message[]) => void;
  onSessionId: (sessionId: string) => void;
}): Promise<ScratchTurnResult> {
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
    if (isScratchAbortError(err)) return { ok: false, error: "aborted" };
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
    if (isScratchAbortError(err)) return { ok: false, error: "aborted", committed: opts.reuseUser };
    return { ok: false, error: err instanceof Error ? err.message : String(err), committed: opts.reuseUser };
  }
  if (!resp.ok || !resp.body) {
    return { ok: false, error: `HTTP ${resp.status}`, committed: opts.reuseUser };
  }

  let messages = opts.reuseUser
    ? appendScratchAssistant(opts.chat.messages ?? [], {
        assistantId: opts.ids.assistantId,
        sessionId,
      })
    : appendScratchTurn(opts.chat.messages ?? [], {
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
    if (isScratchAbortError(err)) return { ok: false, error: "aborted", committed: true };
    return { ok: false, error: err instanceof Error ? err.message : String(err), committed: true };
  }
  const assistant = messages.find((item) => item.id === opts.ids.assistantId);
  if (!scratchVisibleReplyText(assistant?.content ?? "")) {
    return { ok: false, error: "empty_reply", committed: true };
  }
  return { ok: true };
}
