import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  HeatmapDimension,
  HeatmapMetric,
  HeatmapQueryInput,
  HeatmapQueryResult,
  HeatmapTimeGranularity,
  MeteringGroupKey,
  MeteringPivotRow,
  MeteringQueryInput,
  MeteringQueryResult,
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
}

