/**
 * Meta `/api/chat` SSE bridge for Doubao voice「工具一问」.
 * Does not emit VoiceRealtimeEmit; failures are surfaced by the caller (no auto hangup).
 */

export type MetaBridgeToolCallRecord = {
  callId: string;
  name: string;
  args: Record<string, unknown>;
  result: string;
};

export type MetaBridgeResult = {
  finalText: string;
  toolCalls: MetaBridgeToolCallRecord[];
};

function withBase(apiBase: string, path: string): string {
  return `${apiBase.replace(/\/+$/, "")}${path}`;
}

export async function runMetaTurnViaChat(args: {
  apiBase: string;
  desktopToken: string;
  sessionId: string;
  query: string;
  provider?: string;
  model?: string;
  signal?: AbortSignal;
}): Promise<MetaBridgeResult> {
  const { apiBase, desktopToken, sessionId, query, provider, model, signal } = args;
  const q = query.trim();
  if (!q) return { finalText: "", toolCalls: [] };
  const providerName = String(provider ?? "").trim();
  const modelName = String(model ?? "").trim();

  const resp = await fetch(withBase(apiBase, "/api/chat"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agx-desktop-token": desktopToken,
    },
    body: JSON.stringify({
      user_input: q,
      session_id: sessionId,
      ...(providerName ? { provider: providerName } : {}),
      ...(modelName ? { model: modelName } : {}),
    }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    const detail = await resp.text().catch(() => "");
    throw new Error(`chat HTTP ${resp.status}: ${detail.slice(0, 280)}`);
  }

  let full = "";
  const toolCalls: MetaBridgeToolCallRecord[] = [];
  const pendingById = new Map<string, { name: string; args: Record<string, unknown> }>();

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handlePayload = (payload: Record<string, unknown>) => {
    const type = String(payload.type ?? "");
    const data = (payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : {}) as Record<string, unknown>;

    if (type === "token") {
      const delta = String(data.text ?? data.delta ?? "");
      if (delta) full += delta;
      return;
    }
    if (type === "tool_call") {
      const callId = String(data.tool_call_id ?? data.id ?? "").trim();
      const name = String(data.name ?? "").trim();
      let argsObj: Record<string, unknown> = {};
      const rawArgs = data.arguments ?? data.args;
      if (typeof rawArgs === "string") {
        try {
          const parsed = JSON.parse(rawArgs) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            argsObj = parsed as Record<string, unknown>;
          }
        } catch {
          argsObj = {};
        }
      } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
        argsObj = rawArgs as Record<string, unknown>;
      }
      if (callId) pendingById.set(callId, { name, args: argsObj });
      return;
    }
    if (type === "tool_result") {
      const callId = String(data.tool_call_id ?? data.id ?? "").trim();
      const name = String(data.name ?? "").trim();
      const result = String(data.result ?? "");
      const pend = callId ? pendingById.get(callId) : undefined;
      toolCalls.push({
        callId: callId || `tc_${Date.now()}_${toolCalls.length}`,
        name: name || pend?.name || "tool",
        args: pend?.args ?? {},
        result,
      });
      if (callId) pendingById.delete(callId);
      return;
    }
    if (type === "final") {
      const maybe = String(data.text ?? data.content ?? "").trim();
      if (maybe) full = maybe;
      return;
    }
    if (type === "error") {
      const errText = String(data.text ?? data.error ?? payload.error ?? "unknown chat error");
      throw new Error(errText);
    }
    // token_usage, done, round_start, etc. — ignore
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";

    for (const frame of frames) {
      const lines = frame.split("\n");
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const jsonStr = line.slice(5).trim();
        if (!jsonStr || jsonStr === "[DONE]") continue;
        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(jsonStr) as Record<string, unknown>;
        } catch {
          continue;
        }
        const maybeAction = payload.action;
        if (maybeAction === "done" || String(maybeAction ?? "") === "done") continue;
        handlePayload(payload);
      }
    }
  }

  return { finalText: full.trim(), toolCalls };
}
