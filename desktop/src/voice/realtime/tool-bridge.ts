import type { VoiceToolScope } from "./types";

export type VoiceToolSchema = {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
};

type ToolSchemasResp = {
  ok?: boolean;
  mode?: VoiceToolScope;
  tools?: VoiceToolSchema[];
};

type ToolCallResp = {
  ok?: boolean;
  result?: string;
  error?: string;
};

function withBase(apiBase: string, path: string): string {
  return `${apiBase.replace(/\/+$/, "")}${path}`;
}

export async function fetchToolSchemas(args: {
  apiBase: string;
  desktopToken: string;
  mode: VoiceToolScope;
}): Promise<VoiceToolSchema[]> {
  const resp = await fetch(withBase(args.apiBase, `/api/voice/tool_schemas?mode=${encodeURIComponent(args.mode)}`), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
      "x-agx-desktop-token": args.desktopToken,
    },
  });
  if (!resp.ok) {
    const detail = (await resp.text().catch(() => "")).slice(0, 300);
    throw new Error(`tool_schemas HTTP ${resp.status}: ${detail}`);
  }
  const body = (await resp.json()) as ToolSchemasResp;
  const tools = Array.isArray(body.tools) ? body.tools : [];
  return tools;
}

export async function runToolCall(args: {
  apiBase: string;
  desktopToken: string;
  sessionId: string;
  callId: string;
  name: string;
  argumentsJson: string;
}): Promise<{ ok: boolean; output: string }> {
  const resp = await fetch(withBase(args.apiBase, "/api/voice/tool_call"), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-agx-desktop-token": args.desktopToken,
    },
    body: JSON.stringify({
      session_id: args.sessionId,
      call_id: args.callId,
      name: args.name,
      arguments: args.argumentsJson,
    }),
  });
  const body = (await resp.json().catch(() => ({}))) as ToolCallResp;
  if (!resp.ok) {
    return { ok: false, output: `Tool call HTTP ${resp.status}: ${String(body.error || "").slice(0, 200)}` };
  }
  if (!body.ok) {
    return { ok: false, output: String(body.error || "tool call failed").slice(0, 2000) };
  }
  return { ok: true, output: String(body.result || "") };
}
