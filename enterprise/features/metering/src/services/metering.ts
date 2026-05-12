import { readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import type { MeteringGroupKey, MeteringPivotRow, MeteringQueryInput, MeteringQueryResult } from "../types";

const GROUP_COLUMN: Record<MeteringGroupKey, string> = {
  dept: "dept_id",
  user: "user_id",
  provider: "provider",
  model: "model",
  day: "date_trunc('day', time_bucket)",
};

const ALIAS: Record<MeteringGroupKey, string> = {
  dept: "dept",
  user: "user",
  provider: "provider",
  model: "model",
  day: "day",
};

export class MeteringService {
  private readonly pool: Pool;
  private readonly usageLogPath: string;

  public constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString ?? process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/agenticx",
    });
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
    const placeholders = values.map((_, idx) => `$${params.length + idx + 1}`).join(",");
    where.push(`${field} in (${placeholders})`);
    params.push(...values);
  }

  public async query(input: MeteringQueryInput): Promise<MeteringQueryResult> {
    const groups: MeteringGroupKey[] = input.group_by.length > 0 ? input.group_by : ["day"];
    const selectGroup = groups.map((group) => `${GROUP_COLUMN[group]} as ${ALIAS[group]}`);
    const groupBy = groups.map((group) => GROUP_COLUMN[group]);

    const where: string[] = [];
    const params: Array<string | number | Date> = [];
    where.push(`tenant_id = $${params.length + 1}`);
    params.push(input.tenant_id);
    where.push(`time_bucket >= $${params.length + 1}`);
    params.push(input.start);
    where.push(`time_bucket <= $${params.length + 1}`);
    params.push(input.end);
    this.pushInClause("dept_id", input.dept_id, where, params);
    this.pushInClause("user_id", input.user_id, where, params);
    this.pushInClause("provider", input.provider, where, params);
    this.pushInClause("model", input.model, where, params);

    const sql = `
      select
        ${selectGroup.join(",\n        ")},
        coalesce(sum(input_tokens), 0)::bigint as input_tokens,
        coalesce(sum(output_tokens), 0)::bigint as output_tokens,
        coalesce(sum(total_tokens), 0)::bigint as total_tokens,
        coalesce(sum(cost_usd), 0)::numeric(18,8) as cost_usd
      from usage_records
      where ${where.join(" and ")}
      group by ${groupBy.join(", ")}
      order by ${groupBy.join(", ")}
    `;

    try {
      const result = await this.pool.query(sql, params);
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
      Provider?: string;
      Model?: string;
      TimeBucket?: string;
      InputTokens?: number;
      OutputTokens?: number;
      TotalTokens?: number;
      CostUSD?: number;
    };
    type AggRow = {
      dims: Record<string, string | null>;
      input_tokens: number;
      output_tokens: number;
      total_tokens: number;
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
        cost_usd: 0,
      };
      current.input_tokens += Number(parsed.InputTokens ?? 0);
      current.output_tokens += Number(parsed.OutputTokens ?? 0);
      current.total_tokens += Number(parsed.TotalTokens ?? 0);
      current.cost_usd += Number(parsed.CostUSD ?? 0);
      buckets.set(key, current);
    }
    return {
      rows: Array.from(buckets.values()),
    };
  }
}

