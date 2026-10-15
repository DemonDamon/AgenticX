export type RuntimeSpan = {
  trace_id: string;
  step_kind: string;
  status: string;
  model: string | null;
  provider: string | null;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  duration_ms: number;
  created_at: string;
  metadata: Record<string, unknown> | null;
};

export type RuntimeAgent = {
  id: string;
  slug: string;
  displayName: string;
  localAvatarId: string | null;
  status: string;
};

export type RuntimeUser = {
  id: string;
  displayName: string;
};

export type RuntimeDashboardQuery = {
  userId?: string;
  agentId?: string;
  model?: string;
  service?: string;
  source?: "desktop" | "web" | "";
};

export type RuntimeMetric = {
  value: number;
  previous: number;
  /** 上一时段为 0 且本时段有数时为 null，避免编造涨幅。 */
  delta_pct: number | null;
};

export type RuntimeDashboard = {
  window_hours: number;
  registered_agents: number;
  cards: {
    agents: RuntimeMetric;
    requests: RuntimeMetric;
    model_calls: RuntimeMetric;
    input_tokens: RuntimeMetric;
    output_tokens: RuntimeMetric;
    total_tokens: RuntimeMetric;
    model_errors: RuntimeMetric;
  };
  filters: {
    users: Array<{ id: string; label: string }>;
    agents: Array<{ id: string; label: string }>;
    models: string[];
    services: string[];
    sources: Array<"desktop" | "web">;
  };
  request_trend: Array<{ bucket: string; requests: number; errors: number }>;
  model_call_trend: Array<{ bucket: string; calls: number }>;
  requests_by_agent: Array<{ name: string; requests: number }>;
  calls_by_agent_model: Array<{ name: string; calls: number }>;
  token_buckets: Array<{ bucket: string; traces: number }>;
  model_error_trend: Array<{ bucket: string; errors: number }>;
  tokens_by_model: Array<{ name: string; tokens: number }>;
  tps_by_model: Array<{ name: string; tps: number }>;
};

const HOUR_MS = 60 * 60 * 1000;
const WINDOW_MS = 24 * HOUR_MS;
const SHANGHAI_OFFSET_MS = 8 * HOUR_MS;

const TOKEN_BUCKETS: Array<{ bucket: string; min: number; max: number }> = [
  { bucket: "<100", min: 0, max: 100 },
  { bucket: "100-500", min: 100, max: 500 },
  { bucket: "500-1K", min: 500, max: 1_000 },
  { bucket: "1K-5K", min: 1_000, max: 5_000 },
  { bucket: "5K-20K", min: 5_000, max: 20_000 },
  { bucket: ">20K", min: 20_000, max: Number.POSITIVE_INFINITY },
];

type TraceBundle = {
  id: string;
  time: number;
  source: "desktop" | "web";
  userId: string;
  agentId: string;
  error: boolean;
  spans: RuntimeSpan[];
};

function textOf(metadata: Record<string, unknown> | null | undefined, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function stamp(iso: string): number {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? value : 0;
}

function deltaPct(value: number, previous: number): number | null {
  if (previous === 0) return value === 0 ? 0 : null;
  return Math.round(((value - previous) / previous) * 1000) / 10;
}

function metric(value: number, previous: number): RuntimeMetric {
  return { value, previous, delta_pct: deltaPct(value, previous) };
}

function hourKey(time: number): number {
  return Math.floor(time / HOUR_MS) * HOUR_MS;
}

function formatBucket(hourUtc: number): string {
  const shifted = new Date(hourUtc + SHANGHAI_OFFSET_MS);
  const month = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const day = String(shifted.getUTCDate()).padStart(2, "0");
  const hour = String(shifted.getUTCHours()).padStart(2, "0");
  return `${month}-${day} ${hour}:00`;
}

function bundleSpans(spans: RuntimeSpan[]): TraceBundle[] {
  const grouped = new Map<string, RuntimeSpan[]>();
  for (const span of spans) {
    const list = grouped.get(span.trace_id) ?? [];
    list.push(span);
    grouped.set(span.trace_id, list);
  }
  return [...grouped.entries()].map(([id, items]) => {
    const times = items.map((span) => stamp(span.created_at)).filter((value) => value > 0);
    const run = items.find((span) => span.step_kind === "run");
    const agentId = textOf(run?.metadata, "agent_id") || items.map((span) => textOf(span.metadata, "agent_id")).find(Boolean) || "";
    const userId = items.map((span) => textOf(span.metadata, "user_id")).find(Boolean) || "";
    const desktop = id.startsWith("near:") || items.some((span) => textOf(span.metadata, "source") === "near");
    return {
      id,
      time: times.length > 0 ? Math.min(...times) : 0,
      source: desktop ? "desktop" : "web",
      userId,
      agentId,
      error: items.some((span) => span.status === "error"),
      spans: items,
    };
  });
}

function serviceOf(span: RuntimeSpan): string {
  return textOf(span.metadata, "service_name") || textOf(span.metadata, "service") || span.provider?.trim() || "";
}

function agentLabel(agentId: string, agents: RuntimeAgent[]): string {
  if (!agentId || agentId === "meta") return "元智能体";
  const found = agents.find((agent) => agent.id === agentId || agent.localAvatarId === agentId || agent.slug === agentId);
  return found?.displayName || agentId;
}

function userLabel(userId: string, users: RuntimeUser[]): string {
  const found = users.find((user) => user.id === userId);
  return found?.displayName || userId;
}

function matches(trace: TraceBundle, query: RuntimeDashboardQuery): boolean {
  if (query.userId && trace.userId !== query.userId) return false;
  if (query.agentId && trace.agentId !== query.agentId) return false;
  if (query.source && trace.source !== query.source) return false;
  if (query.model && !trace.spans.some((span) => span.step_kind === "model" && span.model === query.model)) return false;
  if (query.service && !trace.spans.some((span) => serviceOf(span) === query.service)) return false;
  return true;
}

function countedModelSpans(trace: TraceBundle, query: RuntimeDashboardQuery): RuntimeSpan[] {
  return trace.spans.filter((span) => {
    if (span.step_kind !== "model") return false;
    if (query.model && span.model !== query.model) return false;
    if (query.service && serviceOf(span) !== query.service) return false;
    return true;
  });
}

function inRange(time: number, start: number, end: number): boolean {
  return time >= start && time < end;
}

function topCounts(counts: Map<string, number>, limit: number): Array<{ name: string; calls: number }> {
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name, calls]) => ({ name, calls }));
}

export function buildRuntimeDashboard(
  spans: RuntimeSpan[],
  agents: RuntimeAgent[],
  users: RuntimeUser[],
  query: RuntimeDashboardQuery,
  now: number,
): RuntimeDashboard {
  const traces = bundleSpans(spans);
  const selected = traces.filter((trace) => matches(trace, query));
  const currentStart = now - WINDOW_MS;
  const previousStart = now - 2 * WINDOW_MS;
  const endHour = hourKey(now);
  const hours = Array.from({ length: 24 }, (_, index) => endHour - (23 - index) * HOUR_MS);

  const currentTraces = selected.filter((trace) => inRange(trace.time, currentStart, now));
  const previousTraces = selected.filter((trace) => inRange(trace.time, previousStart, currentStart));

  const distinctAgents = (rows: TraceBundle[]) => new Set(rows.map((trace) => trace.agentId).filter(Boolean)).size;

  let inputTokens = 0;
  let outputTokens = 0;
  let totalTokens = 0;
  let previousInput = 0;
  let previousOutput = 0;
  let previousTotal = 0;
  let modelCalls = 0;
  let previousModelCalls = 0;
  let modelErrors = 0;
  let previousModelErrors = 0;
  const callTrend = new Map<number, number>(hours.map((hour) => [hour, 0]));
  const errorTrend = new Map<number, number>(hours.map((hour) => [hour, 0]));
  const callsByAgentModel = new Map<string, number>();
  const tokensByModel = new Map<string, number>();
  const tpsByModel = new Map<string, { output: number; duration: number }>();
  const bucketCounts = new Map(TOKEN_BUCKETS.map((item) => [item.bucket, 0]));

  const consume = (rows: TraceBundle[], current: boolean) => {
    for (const trace of rows) {
      const models = countedModelSpans(trace, query);
      let traceTokens = 0;
      for (const span of models) {
        const at = stamp(span.created_at);
        const inCurrent = inRange(at, currentStart, now);
        const inPrevious = inRange(at, previousStart, currentStart);
        if (!inCurrent && !inPrevious) continue;
        if (current && !inCurrent) continue;
        if (!current && !inPrevious) continue;
        if (current) {
          inputTokens += span.input_tokens;
          outputTokens += span.output_tokens;
          totalTokens += span.total_tokens;
          modelCalls += 1;
          traceTokens += span.total_tokens;
          const hour = hourKey(at);
          if (callTrend.has(hour)) callTrend.set(hour, (callTrend.get(hour) ?? 0) + 1);
          if (span.status === "error") {
            modelErrors += 1;
            if (errorTrend.has(hour)) errorTrend.set(hour, (errorTrend.get(hour) ?? 0) + 1);
          }
          const name = `${agentLabel(trace.agentId, agents)} · ${span.model || "未知模型"}`;
          callsByAgentModel.set(name, (callsByAgentModel.get(name) ?? 0) + 1);
          const modelName = span.model || "未知模型";
          tokensByModel.set(modelName, (tokensByModel.get(modelName) ?? 0) + span.total_tokens);
          if (span.duration_ms > 0) {
            const pace = tpsByModel.get(modelName) ?? { output: 0, duration: 0 };
            pace.output += span.output_tokens;
            pace.duration += span.duration_ms;
            tpsByModel.set(modelName, pace);
          }
        } else {
          previousInput += span.input_tokens;
          previousOutput += span.output_tokens;
          previousTotal += span.total_tokens;
          previousModelCalls += 1;
          if (span.status === "error") previousModelErrors += 1;
        }
      }
      if (current) {
        const bucket = TOKEN_BUCKETS.find((item) => traceTokens >= item.min && traceTokens < item.max);
        if (bucket) bucketCounts.set(bucket.bucket, (bucketCounts.get(bucket.bucket) ?? 0) + 1);
      }
    }
  };
  consume(currentTraces, true);
  consume(previousTraces, false);

  const requestTrend = new Map<number, { requests: number; errors: number }>(
    hours.map((hour) => [hour, { requests: 0, errors: 0 }]),
  );
  for (const trace of currentTraces) {
    const hour = hourKey(trace.time);
    const slot = requestTrend.get(hour);
    if (!slot) continue;
    slot.requests += 1;
    if (trace.error) slot.errors += 1;
  }

  const requestsByAgent = new Map<string, number>();
  for (const trace of currentTraces) {
    const name = trace.agentId ? agentLabel(trace.agentId, agents) : "未标注";
    requestsByAgent.set(name, (requestsByAgent.get(name) ?? 0) + 1);
  }

  const usersSeen = new Map<string, string>();
  const agentsSeen = new Map<string, string>();
  const models = new Set<string>();
  const services = new Set<string>();
  const sources = new Set<"desktop" | "web">();
  for (const trace of traces) {
    if (trace.userId) usersSeen.set(trace.userId, userLabel(trace.userId, users));
    if (trace.agentId) agentsSeen.set(trace.agentId, agentLabel(trace.agentId, agents));
    sources.add(trace.source);
    for (const span of trace.spans) {
      if (span.model) models.add(span.model);
      const service = serviceOf(span);
      if (service) services.add(service);
    }
  }

  return {
    window_hours: 24,
    registered_agents: agents.filter((agent) => agent.status !== "disabled").length,
    cards: {
      agents: metric(distinctAgents(currentTraces), distinctAgents(previousTraces)),
      requests: metric(currentTraces.length, previousTraces.length),
      model_calls: metric(modelCalls, previousModelCalls),
      input_tokens: metric(inputTokens, previousInput),
      output_tokens: metric(outputTokens, previousOutput),
      total_tokens: metric(totalTokens, previousTotal),
      model_errors: metric(modelErrors, previousModelErrors),
    },
    filters: {
      users: [...usersSeen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
      agents: [...agentsSeen.entries()].map(([id, label]) => ({ id, label })).sort((a, b) => a.label.localeCompare(b.label)),
      models: [...models].sort(),
      services: [...services].sort(),
      sources: [...sources].sort(),
    },
    request_trend: hours.map((hour) => ({
      bucket: formatBucket(hour),
      requests: requestTrend.get(hour)?.requests ?? 0,
      errors: requestTrend.get(hour)?.errors ?? 0,
    })),
    model_call_trend: hours.map((hour) => ({ bucket: formatBucket(hour), calls: callTrend.get(hour) ?? 0 })),
    requests_by_agent: topCounts(requestsByAgent, 10).map(({ name, calls }) => ({ name, requests: calls })),
    calls_by_agent_model: topCounts(callsByAgentModel, 10),
    token_buckets: TOKEN_BUCKETS.map((item) => ({ bucket: item.bucket, traces: bucketCounts.get(item.bucket) ?? 0 })),
    model_error_trend: hours.map((hour) => ({ bucket: formatBucket(hour), errors: errorTrend.get(hour) ?? 0 })),
    tokens_by_model: [...tokensByModel.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 10)
      .map(([name, tokens]) => ({ name, tokens })),
    tps_by_model: [...tpsByModel.entries()]
      .map(([name, stat]) => ({ name, tps: Math.round((stat.output / (stat.duration / 1000)) * 10) / 10 }))
      .sort((a, b) => b.tps - a.tps || a.name.localeCompare(b.name))
      .slice(0, 10),
  };
}
