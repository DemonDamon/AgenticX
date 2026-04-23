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

  public constructor(connectionString?: string) {
    this.pool = new Pool({
      connectionString: connectionString ?? process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/agenticx",
    });
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

    const result = await this.pool.query(sql, params);
    const rows: MeteringPivotRow[] = result.rows.map((row: Record<string, unknown>) => {
      const dims: Record<string, string | null> = {};
      for (const group of groups) {
        const key = ALIAS[group];
        const raw = row[key];
        dims[key] = raw == null ? null : String(raw);
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
  }
}

