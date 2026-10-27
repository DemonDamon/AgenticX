/** Managed-agent wire event (server StoredEvent.to_wire or client event echoed back). */

export type MaContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: Record<string, unknown> }
  | {
      type: "document";
      source: { type: "text"; text: string } | { type: "file"; file_id: string };
      title?: string | null;
    };

export type MaStopReason = {
  type:
    | "end_turn"
    | "requires_action"
    | "retries_exhausted"
    | "refusal"
    | "max_tool_rounds"
    | "budget_exceeded"
    | "policy_blocked";
  event_ids?: string[];
};

export type MaWireEvent = {
  id: string;
  seq: number;
  type: string;
  created_at?: string;
  thread_id?: string | null;
  [key: string]: unknown;
};

export type MaPreviewFrame =
  | { type: "event_start"; event: { type: string; [key: string]: unknown } }
  | { type: "event_delta"; event_type: "agent.message" | "agent.thinking"; content_delta: string };

export type MaSessionStatus = "idle" | "running" | "requires_action" | "terminated";

export type MaUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  tool_calls: number;
  runtime_ms: number;
};

export type MaClientEvent =
  | { type: "user.message"; content: MaContentBlock[] }
  | { type: "user.interrupt" }
  | { type: "user.tool_confirmation"; tool_use_id: string; result: "allow" | "deny"; deny_message?: string };

export type MaApiError = { ok: false; status: number; code: string; message: string };
