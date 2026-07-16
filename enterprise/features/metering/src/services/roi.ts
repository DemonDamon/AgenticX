import { ulid } from "ulid";
import type {
  BusinessRevenueInput,
  BusinessRevenueRecord,
  HeatmapDimension,
  RoiReportInput,
  RoiReportResult,
} from "../types";
import { computeRoiRows } from "./roi-utils";
import { resolveDatabaseConfig } from "@agenticx/iam-core";
import {
  createMysqlExecutor,
  createPostgresqlExecutor,
  mysqlMeteringSql,
  postgresqlMeteringSql,
  type MeteringSqlBuilder,
  type SqlExecutor,
} from "./sql";

const ROI_DIM_COLUMN: Record<HeatmapDimension, string> = {
  dept: "dept_id",
  user: "user_id",
  model: "model",
  pat: "api_token_id",
  provider: "provider",
};

export class RoiService {
  private readonly database: SqlExecutor;
  private readonly sql: MeteringSqlBuilder;

  public constructor(connectionString?: string) {
    const config = resolveDatabaseConfig({
      DATABASE_URL: connectionString ?? process.env.DATABASE_URL,
      DATABASE_DIALECT: process.env.DATABASE_DIALECT,
      NODE_ENV: process.env.NODE_ENV,
    });
    this.database =
      config.dialect === "mysql"
        ? createMysqlExecutor(config.url)
        : createPostgresqlExecutor(config.url);
    this.sql = config.dialect === "mysql" ? mysqlMeteringSql : postgresqlMeteringSql;
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

  public async listRevenues(tenantId: string): Promise<BusinessRevenueRecord[]> {
    try {
      const result = await this.database.query(
        `
          select id, tenant_id, scenario_label, period_start, period_end, revenue_usd, notes, created_at, updated_at
          from enterprise_business_revenue
          where tenant_id = $1
          order by period_start desc, scenario_label asc
        `,
        [tenantId]
      );
      return result.rows.map((row) => this.mapRevenueRow(row));
    } catch {
      return [];
    }
  }

  public async createRevenue(input: BusinessRevenueInput): Promise<BusinessRevenueRecord> {
    const id = ulid();
    await this.database.query(
      `
        insert into enterprise_business_revenue
          (id, tenant_id, scenario_label, period_start, period_end, revenue_usd, notes, created_at, updated_at)
        values ($1, $2, $3, $4, $5, $6, $7, ${this.sql.now()}, ${this.sql.now()})
      `,
      [id, input.tenant_id, input.scenario_label, input.period_start, input.period_end, input.revenue_usd, input.notes ?? null]
    );
    const created = await this.getRevenue(input.tenant_id, id);
    if (!created) throw new Error("failed to create revenue record");
    return created;
  }

  public async updateRevenue(
    tenantId: string,
    id: string,
    patch: Partial<Omit<BusinessRevenueInput, "tenant_id">>
  ): Promise<BusinessRevenueRecord | null> {
    const fields: string[] = [];
    const params: Array<string | number | null> = [tenantId, id];
    if (patch.scenario_label != null) {
      params.push(patch.scenario_label);
      fields.push(`scenario_label = $${params.length}`);
    }
    if (patch.period_start != null) {
      params.push(patch.period_start);
      fields.push(`period_start = $${params.length}`);
    }
    if (patch.period_end != null) {
      params.push(patch.period_end);
      fields.push(`period_end = $${params.length}`);
    }
    if (patch.revenue_usd != null) {
      params.push(patch.revenue_usd);
      fields.push(`revenue_usd = $${params.length}`);
    }
    if (patch.notes !== undefined) {
      params.push(patch.notes);
      fields.push(`notes = $${params.length}`);
    }
    if (fields.length === 0) {
      const existing = await this.getRevenue(tenantId, id);
      return existing;
    }
    fields.push(`updated_at = ${this.sql.now()}`);
    const result = await this.database.query(
      `
        update enterprise_business_revenue
        set ${fields.join(", ")}
        where tenant_id = $1 and id = $2
      `,
      params
    );
    return this.getRevenue(tenantId, id);
  }

  public async deleteRevenue(tenantId: string, id: string): Promise<boolean> {
    const result = await this.database.query(`delete from enterprise_business_revenue where tenant_id = $1 and id = $2`, [
      tenantId,
      id,
    ]);
    return (result.rowCount ?? 0) > 0;
  }

  public async getRevenue(tenantId: string, id: string): Promise<BusinessRevenueRecord | null> {
    try {
      const result = await this.database.query(
        `
          select id, tenant_id, scenario_label, period_start, period_end, revenue_usd, notes, created_at, updated_at
          from enterprise_business_revenue
          where tenant_id = $1 and id = $2
          limit 1
        `,
        [tenantId, id]
      );
      const row = result.rows[0];
      if (!row) return null;
      return this.mapRevenueRow(row);
    } catch {
      return null;
    }
  }

  public async computeReport(input: RoiReportInput): Promise<RoiReportResult> {
    const dimExpr = `coalesce(${this.sql.text(ROI_DIM_COLUMN[input.dimension])}, '(none)')`;
    const where: string[] = [];
    const params: Array<string | number | Date> = [];
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

    let costs: Array<{ label: string; cost_usd: number }> = [];
    try {
      const costResult = await this.database.query(
        `
          select ${dimExpr} as label, ${this.sql.decimal("coalesce(sum(cost_usd), 0)")} as cost_usd
          from usage_records
          where ${where.join(" and ")}
          group by 1
          order by 2 desc
          limit 200
        `,
        params
      );
      costs = costResult.rows.map((row) => ({
        label: String(row.label ?? "(none)"),
        cost_usd: Number(row.cost_usd ?? 0),
      }));
    } catch {
      costs = [];
    }

    let revenues: Array<{ scenario_label: string; revenue_usd: number }> = [];
    try {
      const revenueResult = await this.database.query(
        `
          select scenario_label, ${this.sql.decimal("coalesce(sum(revenue_usd), 0)")} as revenue_usd
          from enterprise_business_revenue
          where tenant_id = $1
            and period_start <= $3
            and period_end >= $2
          group by scenario_label
        `,
        [input.tenant_id, input.start, input.end]
      );
      revenues = revenueResult.rows.map((row) => ({
        scenario_label: String(row.scenario_label),
        revenue_usd: Number(row.revenue_usd ?? 0),
      }));
    } catch {
      revenues = [];
    }

    return {
      dimension: input.dimension,
      rows: computeRoiRows(costs, revenues),
    };
  }

  private mapRevenueRow(row: Record<string, unknown>): BusinessRevenueRecord {
    return {
      id: String(row.id),
      tenant_id: String(row.tenant_id),
      scenario_label: String(row.scenario_label),
      period_start: row.period_start instanceof Date ? row.period_start.toISOString() : String(row.period_start),
      period_end: row.period_end instanceof Date ? row.period_end.toISOString() : String(row.period_end),
      revenue_usd: Number(row.revenue_usd ?? 0),
      notes: row.notes == null ? null : String(row.notes),
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  }
}
