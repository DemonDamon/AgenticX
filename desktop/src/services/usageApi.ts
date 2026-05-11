/**
 * Client for Studio `/api/usage/*` token dashboard endpoints.
 */

import type { TokenDashboardRange } from "../store";

export type UsageSummary = {
  tokens: number;
  input: number;
  output: number;
  cached: number;
  reasoning: number;
  cost_usd: number;
  conversations: number;
};

export type UsageBreakdownItem = {
  key: string;
  tokens: number;
  percent: number;
  cost_usd: number;
  model_count?: number;
};

export type UsageDailyRow = {
  date: string;
  total: number;
  input: number;
  output: number;
  cached: number;
  reasoning: number;
  convs: number;
};

export type UsageMeta = {
  started_at: number | null;
  active_days_30d: number;
  month_conversations: number;
};

export type UsageTopModel = {
  model: string;
  tokens: number;
  percent: number;
};

function hdr(token: string): HeadersInit {
  const h: Record<string, string> = {};
  if (token) h["x-agx-desktop-token"] = token;
  return h;
}

function qp(
  range: TokenDashboardRange,
  customFrom?: string,
  customTo?: string,
): string {
  const sp = new URLSearchParams();
  sp.set("range", range);
  if (range === "custom") {
    const f = (customFrom ?? "").trim();
    const t = (customTo ?? "").trim();
    if (f) sp.set("from", f);
    if (t) sp.set("to", t);
  }
  return sp.toString();
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export async function fetchUsageSummary(
  apiBase: string,
  token: string,
  range: TokenDashboardRange,
  custom?: { from: string; to: string },
): Promise<UsageSummary> {
  const q = qp(range, custom?.from, custom?.to);
  const res = await fetch(`${apiBase}/api/usage/summary?${q}`, { headers: hdr(token) });
  return j<UsageSummary>(res);
}

export async function fetchUsageBreakdown(
  apiBase: string,
  token: string,
  range: TokenDashboardRange,
  dimension: "provider" | "model",
  custom?: { from: string; to: string },
): Promise<{ dimension: string; items: UsageBreakdownItem[] }> {
  const q = qp(range, custom?.from, custom?.to);
  const res = await fetch(`${apiBase}/api/usage/breakdown?${q}&dimension=${encodeURIComponent(dimension)}`, {
    headers: hdr(token),
  });
  return j(res);
}

export async function fetchUsageDaily(
  apiBase: string,
  token: string,
  range: TokenDashboardRange,
  custom?: { from: string; to: string },
): Promise<{ items: UsageDailyRow[] }> {
  const q = qp(range, custom?.from, custom?.to);
  const res = await fetch(`${apiBase}/api/usage/daily?${q}`, { headers: hdr(token) });
  return j(res);
}

export async function fetchUsageHeatmap(
  apiBase: string,
  token: string,
  range: TokenDashboardRange,
  custom?: { from: string; to: string },
): Promise<{ items: { date: string; total: number }[] }> {
  const q = qp(range, custom?.from, custom?.to);
  const res = await fetch(`${apiBase}/api/usage/heatmap?${q}`, { headers: hdr(token) });
  return j(res);
}

export async function fetchUsageTopModels(
  apiBase: string,
  token: string,
  range: TokenDashboardRange,
  limit: number,
  custom?: { from: string; to: string },
): Promise<{ items: UsageTopModel[] }> {
  const q = qp(range, custom?.from, custom?.to);
  const res = await fetch(
    `${apiBase}/api/usage/top-models?${q}&limit=${encodeURIComponent(String(limit))}`,
    { headers: hdr(token) },
  );
  return j(res);
}

export async function fetchUsageMeta(apiBase: string, token: string): Promise<UsageMeta> {
  const res = await fetch(`${apiBase}/api/usage/meta`, { headers: hdr(token) });
  return j<UsageMeta>(res);
}
