import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  HeatmapDimension,
  HeatmapMetric,
  HeatmapQueryInput,
  HeatmapQueryResult,
  HeatmapTimeGranularity,
  HourlyRidgeResult,
  MeteringGroupKey,
  MeteringPivotRow,
  MeteringQueryInput,
  MeteringQueryResult,
  OverviewQueryInput,
  OverviewStatsResult,
  RequestSizeDistResult,
  TraceListResult,
  UsageRecordInput,
  UsageRecordWriteResult,
} from "../types";
import { buildHeatmapMatrix, emptyHeatmapResult, formatTimeSlot, type RawHeatmapRow } from "./heatmap-utils";
import {
  createMysqlExecutor,
  createPostgresqlExecutor,
  mysqlMeteringSql,
  postgresqlMeteringSql,
  type MeteringSqlBuilder,
  type SqlExecutor,
} from "./sql";
import { resolveDatabaseConfig } from "@agenticx/iam-core";
import { ulid } from "ulid";

const ALIAS: Record<MeteringGroupKey, string> = {
  dept: "dept",
  user: "user",
  provider: "provider",
  model: "model",
  day: "day",
  pat: "pat",
};

/** Linear-interpolated percentile on a pre-sorted ascending array. */
function percentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0] ?? 0;
  const pos = p * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo] ?? 0;
  const frac = pos - lo;
  return (sorted[lo] ?? 0) * (1 - frac) + (sorted[hi] ?? 0) * frac;
}

const HEATMAP_DIM_COLUMN: Record<HeatmapDimension, string> = {
  dept: "dept_id",
  user: "user_id",
  model: "model",
  pat: "api_token_id",
  provider: "provider",
};

const MAX_HEATMAP_TIME_SLOTS: Record<HeatmapTimeGranularity, number> = {
  hour: 168,
  day: 90,
};

function groupColumn(sql: MeteringSqlBuilder, group: MeteringGroupKey): string {
  if (group === "day") return sql.dateBucket("day", "time_bucket");
  const columns: Record<MeteringGroupKey, string> = {
    dept: "dept_id",
    user: "user_id",
    provider: "provider",
    model: "model",
    day: "time_bucket",
    pat: "api_token_id",
  };
  return columns[group];
}

export class MeteringService {
  private readonly database: SqlExecutor;
  private readonly sql: MeteringSqlBuilder;
  private readonly usageLogPath: string;

  public constructor(connectionString?: string) {
    const config = resolveDatabaseConfig({
      ...process.env,
      ...(connectionString ? { DATABASE_URL: connectionString } : {}),
    });
    this.database =
      config.dialect === "mysql"
        ? createMysqlExecutor(config.url)
        : createPostgresqlExecutor(config.url);
    this.sql = config.dialect === "mysql" ? mysqlMeteringSql : postgresqlMeteringSql;
    this.usageLogPath =
      process.env.GATEWAY_USAGE_LOG ??
      path.resolve(process.cwd(), "../../apps/gateway/.runtime/usage.jsonl");
  }

  private pushInClause(
    field: string,
    values: string[] | undefined,
    where: string[],
    params: Array<string | number | Date>
  ): void {
    if (!values || values.length === 0) return;
    const placeholders = values
      .map((_, idx) => this.sql.placeholder(params.length + idx + 1))
      .join(",");
    where.push(`${field} in (${placeholders})`);
    params.push(...values);
  }

  private buildUsageFilters(
    input: Pick<
      MeteringQueryInput,
      "tenant_id" | "start" | "end" | "dept_id" | "user_id" | "api_token_id" | "provider" | "model"
    >,
    where: string[],
    params: Array<string | number | Date>
  ): void {
    where.push(`tenant_id = ${this.sql.placeholder(params.length + 1)}`);
    params.push(input.tenant_id);
    where.push(`time_bucket >= ${this.sql.placeholder(params.length + 1)}`);
    params.push(input.start);
    where.push(`time_bucket <= ${this.sql.placeholder(params.length + 1)}`);
    params.push(input.end);
    this.pushInClause("dept_id", input.dept_id, where, params);
    this.pushInClause("user_id", input.user_id, where, params);
    this.pushInClause("api_token_id", input.api_token_id, where, params);
    this.pushInClause("provider", input.provider, where, params);
    this.pushInClause("model", input.model, where, params);
  }

  public async queryHeatmap(input: HeatmapQueryInput): Promise<HeatmapQueryResult> {
    const metric: HeatmapMetric = input.metric ?? "total_tokens";
    const timeExpr = this.sql.dateBucket(input.time_granularity, "time_bucket");
    const dimExpr = `coalesce(${this.sql.text(HEATMAP_DIM_COLUMN[input.dimension])}, '(none)')`;
    const where: string[] = [];
    const params: Array<string | number | Date> = [];
    this.buildUsageFilters(input, where, params);

    const maxTimeSlots = MAX_HEATMAP_TIME_SLOTS[input.time_granularity];
    const limitDimensions = input.limit_dimensions ?? 30;
    const rowLimit = Math.max(limitDimensions * maxTimeSlots, 1);

    const sql = `
      select
        ${dimExpr} as dim,
        ${timeExpr} as time_slot,
        ${this.sql.bigint("coalesce(sum(total_tokens), 0)")} as total_tokens,
        ${this.sql.decimal("coalesce(sum(cost_usd), 0)")} as cost_usd
      from usage_records
      where ${where.join(" and ")}
      group by 1, 2
      order by 2 asc, 1 asc
      limit ${rowLimit}
    `;

    try {
      const result = await this.database.query(sql, params);
      const rawRows: RawHeatmapRow[] = result.rows.map((row: Record<string, unknown>) => ({
        dim: String(row.dim ?? "(none)"),
        time: formatTimeSlot(row.time_slot, input.time_granularity),
        total_tokens: Number(row.total_tokens ?? 0),
        cost_usd: Number(row.cost_usd ?? 0),
      }));
      const matrix = buildHeatmapMatrix(rawRows, {
        limitDimensions,
        timeGranularity: input.time_granularity,
      });
      return {
        dimension: input.dimension,
        time_granularity: input.time_granularity,
        metric,
        ...matrix,
      };
    } catch {
      if (process.env.GATEWAY_USAGE_JSONL_FALLBACK === "1") {
        return this.queryHeatmapFromUsageLog(input, metric);
      }
      return {
        dimension: input.dimension,
        time_granularity: input.time_granularity,
        metric,
        ...emptyHeatmapResult(),
      };
    }
  }

  private async queryHeatmapFromUsageLog(input: HeatmapQueryInput, metric: HeatmapMetric): Promise<HeatmapQueryResult> {
    const pivot = await this.queryFromUsageLog(
      {
        ...input,
        group_by: [input.dimension === "pat" ? "pat" : input.dimension, "day"],
      },
      [input.dimension === "pat" ? "pat" : input.dimension, "day"]
    );
    const rawRows: RawHeatmapRow[] = pivot.rows.map((row) => ({
      dim: String(row.dims[input.dimension === "pat" ? "pat" : input.dimension] ?? "(none)"),
      time: String(row.dims.day ?? ""),
      total_tokens: row.total_tokens,
      cost_usd: row.cost_usd,
    }));
    const matrix = buildHeatmapMatrix(rawRows, {
      limitDimensions: input.limit_dimensions ?? 30,
      timeGranularity: input.time_granularity,
    });
    return {
      dimension: input.dimension,
      time_granularity: input.time_granularity,
      metric,
      ...matrix,
    };
  }

  public async query(input: MeteringQueryInput): Promise<MeteringQueryResult> {
    const groups: MeteringGroupKey[] = input.group_by.length > 0 ? input.group_by : ["day"];
    const selectGroup = groups.map((group) => `${groupColumn(this.sql, group)} as ${ALIAS[group]}`);
    const groupBy = groups.map((group) => groupColumn(this.sql, group));

    const where: string[] = [];
    const params: Array<string | number | Date> = [];
    this.buildUsageFilters(input, where, params);

    const sql = `
      select
        ${selectGroup.join(",\n        ")},
        coalesce(sum(input_tokens), 0) as input_tokens,
        coalesce(sum(output_tokens), 0) as output_tokens,
        coalesce(sum(total_tokens), 0) as total_tokens,
        coalesce(sum(cached_tokens), 0) as cached_tokens,
        coalesce(sum(cache_read_input_tokens), 0) as cache_read_input_tokens,
        coalesce(sum(cache_creation_input_tokens), 0) as cache_creation_input_tokens,
        coalesce(sum(cost_usd), 0) as cost_usd
      from usage_records
      where ${where.join(" and ")}
      group by ${groupBy.join(", ")}
      order by ${groupBy.join(", ")}
    `;

    try {
      const result = await this.database.query(sql, params);
      const rows: MeteringPivotRow[] = result.rows.map((row: Record<string, unknown>) => {
        const dims: Record<string, string | null> = {};
        for (const group of groups) {
          const key = ALIAS[group];
          const raw = row[key];
          if (raw == null) {
            dims[key] = null;
          } else if (group === "day" && raw instanceof Date) {
            // pg 驱动会把 date_trunc('day', ...) 解析成 Date 对象，
            // 直接 String(Date) 会得到本地化长串（"Thu Apr 23 2026 08:00:00 GMT+0800"），
            // 前端图表 X 轴需要 ISO 短日期。
            dims[key] = raw.toISOString().slice(0, 10);
          } else {
            dims[key] = String(raw);
          }
        }
        return {
          dims,
          input_tokens: Number(row.input_tokens ?? 0),
          output_tokens: Number(row.output_tokens ?? 0),
          total_tokens: Number(row.total_tokens ?? 0),
          cached_tokens: Number(row.cached_tokens ?? 0),
          cache_read_input_tokens: Number(row.cache_read_input_tokens ?? 0),
          cache_creation_input_tokens: Number(row.cache_creation_input_tokens ?? 0),
          cost_usd: Number(row.cost_usd ?? 0),
        };
      });
      return { rows };
    } catch {
      if (process.env.GATEWAY_USAGE_JSONL_FALLBACK === "1") {
        return this.queryFromUsageLog(input, groups);
      }
      return { rows: [] };
    }
  }

  private async queryFromUsageLog(input: MeteringQueryInput, groups: MeteringGroupKey[]): Promise<MeteringQueryResult> {
    let content = "";
    try {
      content = await readFile(this.usageLogPath, "utf-8");
    } catch {
      return { rows: [] };
    }
    const startTs = new Date(input.start).getTime();
    const endTs = new Date(input.end).getTime();
    const rows = content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    type UsageRecord = {
      TenantID?: string;
      DeptID?: string;
      UserID?: string;
      APITokenID?: number;
      Provider?: string;
      Model?: string;
      TimeBucket?: string;
      InputTokens?: number;
      OutputTokens?: number;
      TotalTokens?: number;
      CachedTokens?: number;
      CacheReadInputTokens?: number;
      CacheCreationInputTokens?: number;
      CostUSD?: number;
    };
    type AggRow = {
      dims: Record<string, string | null>;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
      cached_tokens: number;
      cache_read_input_tokens: number;
      cache_creation_input_tokens: number;
      cost_usd: number;
    };

    const buckets = new Map<string, AggRow>();
    for (const line of rows) {
      let parsed: UsageRecord;
      try {
        parsed = JSON.parse(line) as UsageRecord;
      } catch {
        continue;
      }
      const bucketDate = parsed.TimeBucket ? new Date(parsed.TimeBucket) : null;
      const timeMs = bucketDate ? bucketDate.getTime() : NaN;
      if (!Number.isFinite(timeMs)) continue;
      if (timeMs < startTs || timeMs > endTs) continue;
      if ((parsed.TenantID ?? "") !== input.tenant_id) continue;
      if (input.dept_id?.length && !input.dept_id.includes(parsed.DeptID ?? "")) continue;
      if (input.user_id?.length && !input.user_id.includes(parsed.UserID ?? "")) continue;
      if (input.api_token_id?.length && !input.api_token_id.includes(String(parsed.APITokenID ?? ""))) continue;
      if (input.provider?.length && !input.provider.includes(parsed.Provider ?? "")) continue;
      if (input.model?.length && !input.model.includes(parsed.Model ?? "")) continue;

      const dims: Record<string, string | null> = {};
      for (const group of groups) {
        if (group === "day") {
          dims.day = bucketDate ? bucketDate.toISOString().slice(0, 10) : null;
        } else if (group === "dept") {
          dims.dept = parsed.DeptID ?? null;
        } else if (group === "user") {
          dims.user = parsed.UserID ?? null;
        } else if (group === "pat") {
          dims.pat = parsed.APITokenID ? String(parsed.APITokenID) : null;
        } else if (group === "provider") {
          dims.provider = parsed.Provider ?? null;
        } else if (group === "model") {
          dims.model = parsed.Model ?? null;
        }
      }
      const key = groups.map((group) => dims[ALIAS[group]] ?? "").join("|");
      const current = buckets.get(key) ?? {
        dims,
        input_tokens: 0,
        output_tokens: 0,
        total_tokens: 0,
        cached_tokens: 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
        cost_usd: 0,
      };
      current.input_tokens += Number(parsed.InputTokens ?? 0);
      current.output_tokens += Number(parsed.OutputTokens ?? 0);
      current.total_tokens += Number(parsed.TotalTokens ?? 0);
      current.cached_tokens += Number(parsed.CachedTokens ?? 0);
      current.cache_read_input_tokens += Number(parsed.CacheReadInputTokens ?? 0);
      current.cache_creation_input_tokens += Number(parsed.CacheCreationInputTokens ?? 0);
      current.cost_usd += Number(parsed.CostUSD ?? 0);
      buckets.set(key, current);
    }
    return {
      rows: Array.from(buckets.values()),
    };
  }

  public async recordUsage(input: UsageRecordInput): Promise<UsageRecordWriteResult | null> {
    const id = input.id?.trim() || ulid();
    const route = input.route?.trim() || "chat";
    const inputTokens = input.input_tokens ?? 0;
    const outputTokens = input.output_tokens ?? 0;
    const totalTokens = input.total_tokens ?? inputTokens + outputTokens;
    try {
      const placeholders = Array.from({ length: 14 }, (_, index) =>
        this.sql.placeholder(index + 1),
      ).join(",");
      await this.database.query(
        `
          insert into usage_records (
            id, tenant_id, dept_id, user_id, api_token_id, provider, model, route, time_bucket,
            input_tokens, output_tokens, total_tokens, cost_usd, pricing_version, created_at, updated_at
          ) values (
            ${placeholders}, ${this.sql.now()}, ${this.sql.now()}
          )
          ${this.sql.insertIgnore("id")}
        `,
        [
          id,
          input.tenant_id,
          input.dept_id ?? null,
          input.user_id ?? null,
          input.api_token_id ?? null,
          input.provider,
          input.model,
          route,
          input.time_bucket,
          inputTokens,
          outputTokens,
          totalTokens,
          input.cost_usd,
          input.pricing_version ?? null,
        ]
      );
      return {
        id,
        tenant_id: input.tenant_id,
        cost_usd: input.cost_usd,
        time_bucket: input.time_bucket,
        provider: input.provider,
        model: input.model,
      };
    } catch {
      return null;
    }
  }

  // ===================== Overview Stats =====================

  public async queryOverviewStats(input: OverviewQueryInput): Promise<OverviewStatsResult> {
    const where: string[] = [];
    const params: Array<string | number | Date> = [];
    this.buildUsageFilters(input, where, params);

    const sql = `
      select
        coalesce(sum(total_tokens), 0)              as total_tokens,
        coalesce(sum(input_tokens), 0)              as input_tokens,
        coalesce(sum(output_tokens), 0)             as output_tokens,
        coalesce(sum(cached_tokens), 0)             as cached_tokens,
        coalesce(sum(cache_read_input_tokens), 0)   as cache_read_input_tokens,
        coalesce(sum(cost_usd), 0)                  as total_cost,
        count(*)                                     as record_count,
        count(distinct trace_id)                     as session_count,
        count(distinct ${this.sql.dateBucket("day", "time_bucket")}) as day_count
      from usage_records
      where ${where.join(" and ")}
    `;

    try {
      const result = await this.database.query(sql, params);
      const row = result.rows[0] ?? {};
      const totalTokens = Number(row.total_tokens ?? 0);
      const inputTokens = Number(row.input_tokens ?? 0);
      const outputTokens = Number(row.output_tokens ?? 0);
      const cachedTokens = Number(row.cached_tokens ?? 0);
      const cacheReadInput = Number(row.cache_read_input_tokens ?? 0);
      const totalCost = Number(row.total_cost ?? 0);
      const recordCount = Number(row.record_count ?? 0);
      const sessionCount = Number(row.session_count ?? 0);
      const dayCount = Math.max(Number(row.day_count ?? 1), 1);

      const dailyAvg = totalTokens / dayCount;
      const ioRatio = outputTokens > 0 ? inputTokens / outputTokens : 0;
      const cacheHitRate = inputTokens > 0 ? cacheReadInput / inputTokens : 0;

      return {
        total_tokens: totalTokens,
        daily_avg_tokens: Math.round(dailyAvg),
        session_count: sessionCount,
        input_tokens: inputTokens,
        output_tokens: outputTokens,
        io_ratio: Math.round(ioRatio * 100) / 100,
        cached_tokens: cachedTokens,
        cache_hit_rate: Math.round(cacheHitRate * 10000) / 10000, // 0..1 ratio, 4 decimals
        total_cost: totalCost,
        record_count: recordCount,
        day_count: dayCount,
      };
    } catch {
      return {
        total_tokens: 0,
        daily_avg_tokens: 0,
        session_count: 0,
        input_tokens: 0,
        output_tokens: 0,
        io_ratio: 0,
        cached_tokens: 0,
        cache_hit_rate: 0,
        total_cost: 0,
        record_count: 0,
        day_count: 0,
      };
    }
  }

  // ===================== Trace List (下钻) =====================

  public async queryTraceList(input: OverviewQueryInput & { limit?: number }): Promise<TraceListResult> {
    const where: string[] = [];
    const params: Array<string | number | Date> = [];
    this.buildUsageFilters(input, where, params);
    where.push("trace_id is not null");

    const limit = Math.min(Math.max(input.limit ?? 200, 1), 1000);

    // 用 string_agg 收集 model（pg）/ GROUP_CONCAT（mysql）
    const modelAgg = this.sql.dialect === "mysql"
      ? "GROUP_CONCAT(DISTINCT model ORDER BY model SEPARATOR ',')"
      : "STRING_AGG(DISTINCT model, ',' ORDER BY model)";

    const sql = `
      select
        trace_id,
        coalesce(sum(total_tokens), 0)              as total_tokens,
        coalesce(sum(input_tokens), 0)              as input_tokens,
        coalesce(sum(output_tokens), 0)             as output_tokens,
        coalesce(sum(cached_tokens), 0)             as cached_tokens,
        coalesce(sum(cost_usd), 0)                  as cost_usd,
        count(*)                                     as step_count,
        min(time_bucket)                             as first_seen,
        ${modelAgg}                                  as models_csv
      from usage_records
      where ${where.join(" and ")}
      group by trace_id
      order by total_tokens desc
      limit ${limit}
    `;

    try {
      const result = await this.database.query(sql, params);
      const rows = result.rows.map((row: Record<string, unknown>) => ({
        trace_id: String(row.trace_id ?? ""),
        total_tokens: Number(row.total_tokens ?? 0),
        input_tokens: Number(row.input_tokens ?? 0),
        output_tokens: Number(row.output_tokens ?? 0),
        cached_tokens: Number(row.cached_tokens ?? 0),
        cost_usd: Number(row.cost_usd ?? 0),
        step_count: Number(row.step_count ?? 0),
        first_seen: row.first_seen instanceof Date
          ? row.first_seen.toISOString()
          : row.first_seen != null
            ? String(row.first_seen)
            : null,
        models: String(row.models_csv ?? "").split(",").filter(Boolean),
      })).filter((r) => r.trace_id.length > 0);
      return { rows };
    } catch {
      return { rows: [] };
    }
  }

  // ===================== Hourly Ridge (0-24 时模型堆叠) =====================

  public async queryHourlyModelRidge(input: OverviewQueryInput & { top_n?: number }): Promise<HourlyRidgeResult> {
    const where: string[] = [];
    const params: Array<string | number | Date> = [];
    this.buildUsageFilters(input, where, params);

    const topN = Math.min(Math.max(input.top_n ?? 10, 1), 30);

    const hourExpr = this.sql.dialect === "mysql"
      ? "EXTRACT(HOUR FROM time_bucket)"
      : "EXTRACT(HOUR FROM time_bucket)::int";

    const sql = `
      select
        ${hourExpr} as hour,
        model,
        coalesce(sum(total_tokens), 0) as total_tokens
      from usage_records
      where ${where.join(" and ")}
      group by 1, 2
      order by 1, 3 desc
    `;

    try {
      const result = await this.database.query(sql, params);
      const topModels = new Set<string>();
      // 先算每个 model 的总量，取 top N
      const modelTotals = new Map<string, number>();
      for (const row of result.rows as Array<Record<string, unknown>>) {
        const m = String(row.model ?? "(unknown)");
        modelTotals.set(m, (modelTotals.get(m) ?? 0) + Number(row.total_tokens ?? 0));
      }
      const sorted = Array.from(modelTotals.entries()).sort((a, b) => b[1] - a[1]).slice(0, topN);
      for (const [m] of sorted) topModels.add(m);

      const series: Record<string, number[]> = {};
      const hours: number[] = Array.from({ length: 24 }, (_, i) => i);
      const models: string[] = Array.from(topModels);
      for (const m of models) series[m] = Array(24).fill(0);

      for (const row of result.rows as Array<Record<string, unknown>>) {
        const h = Number(row.hour ?? 0);
        const m = String(row.model ?? "(unknown)");
        const tokens = Number(row.total_tokens ?? 0);
        if (topModels.has(m) && h >= 0 && h < 24) {
          const arr = series[m];
          if (arr) arr[h] = (arr[h] ?? 0) + tokens;
        }
      }

      return { hours, models, series };
    } catch {
      return { hours: Array.from({ length: 24 }, (_, i) => i), models: [], series: {} };
    }
  }

  // ===================== Request Size Distribution =====================

  public async queryRequestSizeDistribution(input: OverviewQueryInput & { top_n?: number }): Promise<RequestSizeDistResult> {
    const where: string[] = [];
    const params: Array<string | number | Date> = [];
    this.buildUsageFilters(input, where, params);

    const topN = Math.min(Math.max(input.top_n ?? 15, 1), 50);

    // 先取 top N models（按 total_tokens），然后每个 model 取 total_tokens 排序算分位数
    const topModelSql = `
      select model, count(*) as cnt, sum(total_tokens) as total
      from usage_records
      where ${where.join(" and ")}
      group by model
      order by total desc
      limit ${topN}
    `;

    try {
      const topResult = await this.database.query(topModelSql, params);
      const topModels: string[] = topResult.rows.map((r) => String(r.model ?? "")).filter(Boolean);
      if (topModels.length === 0) return { rows: [] };

      // 取每个 top model 的所有 total_tokens 排序值（JS 端算分位数，跨库兼容）
      const rows: Array<{ model: string; request_count: number; avg_tokens: number; p50: number; p90: number; p99: number }> = [];

      for (const model of topModels) {
        const modelWhere = [...where, `model = ${this.sql.placeholder(params.length + 1)}`];
        const modelParams = [...params, model];

        const valsSql = `
          select total_tokens
          from usage_records
          where ${modelWhere.join(" and ")}
          order by total_tokens asc
        `;
        const valResult = await this.database.query(valsSql, modelParams);
        const values = valResult.rows.map((r) => Number(r.total_tokens ?? 0)).sort((a, b) => a - b);

        if (values.length === 0) continue;

        const count = values.length;
        const sum = values.reduce((s, v) => s + v, 0);
        const avg = sum / count;

        const p50 = percentile(values, 0.5);
        const p90 = percentile(values, 0.9);
        const p99 = percentile(values, 0.99);

        rows.push({
          model,
          request_count: count,
          avg_tokens: Math.round(avg),
          p50: Math.round(p50),
          p90: Math.round(p90),
          p99: Math.round(p99),
        });
      }

      return { rows };
    } catch {
      return { rows: [] };
    }
  }
}

