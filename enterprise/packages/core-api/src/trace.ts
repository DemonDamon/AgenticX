export type TraceNodeKind =
  | "request" // portal_request_logs 一行
  | "model_step" // agent_token_traces 一个 step
  | "dr_phase" // 深度调研阶段（recon/clarify/plan/lanes/reflect/synthesize/done）
  | "dr_lane" // 单条研究支线
  | "dr_event"; // 其余业务事件（plan/sources/reflection/stats/artifact…）

export type TraceNode = {
  id: string;
  kind: TraceNodeKind;
  label: string;
  status?: string;
  startedAt?: string;
  durationMs?: number;
  tokens?: { input: number; output: number; reasoning: number; total: number };
  costUsd?: number;
  attrs?: Record<string, unknown>;
  children: TraceNode[];
};

export type TraceTimeline = {
  trace_id: string;
  nodes: TraceNode[];
  totals: { steps: number; tokens: number; cost_usd: number; duration_ms: number | null };
  sources: { portal_logs: number; model_steps: number; deep_research_run: boolean };
};
