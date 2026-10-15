import type { AgentTraceSpanRow } from "./db-stores/postgresql/agent-trace-store";

export type TraceSource = "desktop" | "web";

export type TraceSummary = {
  trace_id: string;
  session_id: string;
  source: TraceSource;
  status: string;
  started_at: string;
  duration_ms: number;
  model: string | null;
  operation: string;
  input_preview: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  error_kind: string | null;
};

export type SessionSummary = {
  session_id: string;
  source: TraceSource;
  trace_count: number;
  started_at: string;
  duration_ms: number;
  total_tokens: number;
  input_preview: string;
  status: string;
};

export type ModelRank = {
  model: string;
  calls: number;
  tokens: number;
  avg_duration_ms: number;
};

export type ObservationOverview = {
  trace_count: number;
  error_count: number;
  model_calls: number;
  tool_calls: number;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  avg_duration_ms: number;
  p50_duration_ms: number;
  p90_duration_ms: number;
  top_models: ModelRank[];
};

function textOf(metadata: Record<string, unknown> | null, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

export function sessionOf(traceId: string): string {
  if (!traceId.startsWith("near:")) return "";
  const body = traceId.slice(5);
  const splitAt = body.lastIndexOf(":");
  return splitAt > 0 ? body.slice(0, splitAt) : body;
}

export function sourceOf(traceId: string): TraceSource {
  return traceId.startsWith("near:") ? "desktop" : "web";
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? 0;
}

export function buildObservationCenter(spans: AgentTraceSpanRow[]): {
  traces: TraceSummary[];
  sessions: SessionSummary[];
  overview: ObservationOverview;
} {
  const grouped = new Map<string, AgentTraceSpanRow[]>();
  for (const span of spans) {
    const list = grouped.get(span.trace_id) ?? [];
    list.push(span);
    grouped.set(span.trace_id, list);
  }

  const traces: TraceSummary[] = [...grouped.entries()].map(([traceId, items]) => {
    const ordered = [...items].sort((a, b) => a.step_no - b.step_no);
    const run = ordered.find((item) => item.step_kind === "run");
    const failed = ordered.find((item) => item.status !== "ok");
    const modelSpan = ordered.find((item) => item.model);
    const started = ordered.reduce((earliest, item) => (item.created_at < earliest ? item.created_at : earliest), ordered[0]!.created_at);
    const tokens = ordered.reduce(
      (acc, item) => {
        acc.input += item.input_tokens;
        acc.output += item.output_tokens;
        acc.total += item.total_tokens;
        return acc;
      },
      { input: 0, output: 0, total: 0 },
    );
    let errorKind: string | null = null;
    if (failed?.step_kind === "tool") errorKind = "tool";
    else if (failed?.step_kind === "model") errorKind = "model";
    else if (failed) errorKind = "run";
    return {
      trace_id: traceId,
      session_id: sessionOf(traceId),
      source: sourceOf(traceId),
      status: failed?.status ?? "ok",
      started_at: started.toISOString(),
      duration_ms: run?.duration_ms ?? Math.max(...ordered.map((item) => item.duration_ms)),
      model: modelSpan?.model ?? null,
      operation: run ? "本轮运行" : ordered[0]?.step_kind ?? "run",
      input_preview: textOf(run?.metadata ?? null, "user_text"),
      input_tokens: tokens.input,
      output_tokens: tokens.output,
      total_tokens: tokens.total,
      error_kind: errorKind,
    };
  });
  traces.sort((a, b) => b.started_at.localeCompare(a.started_at));

  const sessions = new Map<string, SessionSummary>();
  for (const trace of traces) {
    if (!trace.session_id) continue;
    const current = sessions.get(trace.session_id);
    if (!current) {
      sessions.set(trace.session_id, {
        session_id: trace.session_id,
        source: trace.source,
        trace_count: 1,
        started_at: trace.started_at,
        duration_ms: trace.duration_ms,
        total_tokens: trace.total_tokens,
        input_preview: trace.input_preview,
        status: trace.status,
      });
      continue;
    }
    current.trace_count += 1;
    current.total_tokens += trace.total_tokens;
    current.duration_ms += trace.duration_ms;
    if (trace.started_at < current.started_at) {
      current.started_at = trace.started_at;
      if (!current.input_preview) current.input_preview = trace.input_preview;
    }
    if (trace.status !== "ok") current.status = trace.status;
  }

  const modelStats = new Map<string, { calls: number; tokens: number; duration: number }>();
  for (const span of spans) {
    if (span.step_kind !== "model" || !span.model) continue;
    const current = modelStats.get(span.model) ?? { calls: 0, tokens: 0, duration: 0 };
    current.calls += 1;
    current.tokens += span.total_tokens;
    current.duration += span.duration_ms;
    modelStats.set(span.model, current);
  }
  const durations = traces.map((trace) => trace.duration_ms);
  const overview: ObservationOverview = {
    trace_count: traces.length,
    error_count: traces.filter((trace) => trace.status !== "ok").length,
    model_calls: spans.filter((span) => span.step_kind === "model").length,
    tool_calls: spans.filter((span) => span.step_kind === "tool").length,
    input_tokens: traces.reduce((sum, trace) => sum + trace.input_tokens, 0),
    output_tokens: traces.reduce((sum, trace) => sum + trace.output_tokens, 0),
    total_tokens: traces.reduce((sum, trace) => sum + trace.total_tokens, 0),
    avg_duration_ms: durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0,
    p50_duration_ms: percentile(durations, 50),
    p90_duration_ms: percentile(durations, 90),
    top_models: [...modelStats.entries()]
      .map(([model, stat]) => ({
        model,
        calls: stat.calls,
        tokens: stat.tokens,
        avg_duration_ms: stat.calls ? Math.round(stat.duration / stat.calls) : 0,
      }))
      .sort((a, b) => b.tokens - a.tokens)
      .slice(0, 10),
  };

  return {
    traces,
    sessions: [...sessions.values()].sort((a, b) => b.started_at.localeCompare(a.started_at)),
    overview,
  };
}
