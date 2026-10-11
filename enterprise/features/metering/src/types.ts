export type MeteringGroupKey = "dept" | "user" | "provider" | "model" | "day" | "pat";

export type MeteringQueryInput = {
  tenant_id: string;
  dept_id?: string[];
  user_id?: string[];
  api_token_id?: string[];
  provider?: string[];
  model?: string[];
  start: string;
  end: string;
  group_by: MeteringGroupKey[];
};

export type MeteringPivotRow = {
  dims: Record<string, string | null>;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  cached_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
};

export type MeteringQueryResult = {
  rows: MeteringPivotRow[];
};

export type HeatmapDimension = "dept" | "user" | "model" | "pat" | "provider";

export type HeatmapTimeGranularity = "hour" | "day";

export type HeatmapMetric = "total_tokens" | "cost_usd";

export type HeatmapQueryInput = {
  tenant_id: string;
  dimension: HeatmapDimension;
  time_granularity: HeatmapTimeGranularity;
  metric?: HeatmapMetric;
  dept_id?: string[];
  user_id?: string[];
  api_token_id?: string[];
  provider?: string[];
  model?: string[];
  start: string;
  end: string;
  limit_dimensions?: number;
};

export type HeatmapCell = {
  dim: string;
  time: string;
  total_tokens: number;
  cost_usd: number;
};

export type HeatmapQueryResult = {
  dimension: HeatmapDimension;
  time_granularity: HeatmapTimeGranularity;
  metric: HeatmapMetric;
  dimensions: string[];
  time_slots: string[];
  cells: HeatmapCell[];
};

export type BusinessRevenueRecord = {
  id: string;
  tenant_id: string;
  scenario_label: string;
  period_start: string;
  period_end: string;
  revenue_usd: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type BusinessRevenueInput = {
  tenant_id: string;
  scenario_label: string;
  period_start: string;
  period_end: string;
  revenue_usd: number;
  notes?: string | null;
};

export type RoiReportInput = {
  tenant_id: string;
  dimension: HeatmapDimension;
  start: string;
  end: string;
  dept_id?: string[];
  user_id?: string[];
  api_token_id?: string[];
  provider?: string[];
  model?: string[];
};

export type RoiReportRow = {
  label: string;
  cost_usd: number;
  revenue_usd: number;
  net_usd: number;
  roi: number | null;
};

export type RoiReportResult = {
  dimension: HeatmapDimension;
  rows: RoiReportRow[];
};

export type UsageRecordInput = {
  tenant_id: string;
  id?: string;
  dept_id?: string | null;
  user_id?: string | null;
  api_token_id?: number | null;
  provider: string;
  model: string;
  route?: string;
  time_bucket: string;
  input_tokens?: number;
  output_tokens?: number;
  total_tokens?: number;
  cost_usd: number;
  pricing_version?: string | null;
};

export type UsageRecordWriteResult = {
  id: string;
  tenant_id: string;
  cost_usd: number;
  time_bucket: string;
  provider: string;
  model: string;
};

// ---------- Overview / KPI ----------

export type OverviewQueryInput = {
  tenant_id: string;
  dept_id?: string[];
  user_id?: string[];
  api_token_id?: string[];
  provider?: string[];
  model?: string[];
  start: string;
  end: string;
};

export type OverviewStatsResult = {
  total_tokens: number;
  daily_avg_tokens: number;
  session_count: number;
  input_tokens: number;
  output_tokens: number;
  io_ratio: number;
  cached_tokens: number;
  cache_hit_rate: number;
  total_cost: number;
  record_count: number;
  day_count: number;
};

// ---------- Trace List (下钻) ----------

export type TraceListRow = {
  trace_id: string;
  total_tokens: number;
  input_tokens: number;
  output_tokens: number;
  cached_tokens: number;
  cost_usd: number;
  step_count: number;
  first_seen: string | null;
  models: string[];
};

export type TraceListResult = {
  rows: TraceListRow[];
};

// ---------- Hourly Ridge (0-24 时模型堆叠) ----------

export type HourlyRidgeRow = {
  hour: number; // 0-23
  model: string;
  total_tokens: number;
};

export type HourlyRidgeResult = {
  hours: number[];
  models: string[];
  series: Record<string, number[]>; // model -> [tokens_per_hour_0..23]
};

// ---------- Request Size Distribution ----------

export type RequestSizeDistRow = {
  model: string;
  request_count: number;
  avg_tokens: number;
  p50: number;
  p90: number;
  p99: number;
};

export type RequestSizeDistResult = {
  rows: RequestSizeDistRow[];
};
