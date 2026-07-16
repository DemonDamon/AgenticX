import { resolveDatabaseConfig } from "@agenticx/iam-core";
import { Pool } from "pg";
import mysql from "mysql2/promise";
import { ulid } from "ulid";
import type { BillingSplitRule, BillingSplitRuleInput, SplitParticipant } from "../types";
import { mysqlBillingSql } from "./sql/mysql";
import { postgresqlBillingSql } from "./sql/postgresql";

type BillingSql = typeof postgresqlBillingSql | typeof mysqlBillingSql;

type SqlExecutor = {
  query: (
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>;
};

function bindMysqlParams(sql: string, params: unknown[]): { sql: string; params: unknown[] } {
  const ordered: unknown[] = [];
  const statement = sql.replace(/\$(\d+)/g, (_match, rawIndex: string) => {
    ordered.push(params[Number(rawIndex) - 1]);
    return "?";
  });
  return { sql: statement, params: ordered };
}

function createExecutor(connectionString?: string): { db: SqlExecutor; sql: BillingSql; dialect: "postgresql" | "mysql" } {
  const config = resolveDatabaseConfig({
    DATABASE_URL: connectionString ?? process.env.DATABASE_URL,
    DATABASE_DIALECT: process.env.DATABASE_DIALECT,
    NODE_ENV: process.env.NODE_ENV,
  });
  if (config.dialect === "mysql") {
    const parsed = new URL(config.url);
    const pool = mysql.createPool({
      host: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : 3306,
      user: decodeURIComponent(parsed.username),
      password: decodeURIComponent(parsed.password),
      database: parsed.pathname.replace(/^\//, "") || undefined,
      timezone: "Z",
      charset: "utf8mb4",
    });
    return {
      dialect: "mysql",
      sql: mysqlBillingSql,
      db: {
        async query(text, params = []) {
          const bound = bindMysqlParams(text, params);
          const [rows] = await pool.query(bound.sql, bound.params);
          const list = Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
          return { rows: list, rowCount: list.length };
        },
      },
    };
  }
  const pool = new Pool({ connectionString: config.url });
  return {
    dialect: "postgresql",
    sql: postgresqlBillingSql,
    db: {
      async query(text, params = []) {
        const result = await pool.query(text, params);
        return { rows: result.rows, rowCount: result.rowCount ?? result.rows.length };
      },
    },
  };
}

function parseParticipants(raw: unknown): SplitParticipant[] {
  if (typeof raw === "string") {
    try {
      return parseParticipants(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  if (!Array.isArray(raw)) return [];
  const items: SplitParticipant[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const participantId = typeof record.participant_id === "string" ? record.participant_id.trim() : "";
    const ratioBps = Number(record.ratio_bps);
    if (!participantId || !Number.isFinite(ratioBps) || ratioBps < 0) continue;
    items.push({
      participant_id: participantId,
      label: typeof record.label === "string" ? record.label : undefined,
      ratio_bps: Math.round(ratioBps),
      billing_item: typeof record.billing_item === "string" ? record.billing_item : undefined,
    });
  }
  return items;
}

export class SplitRulesService {
  private readonly db: SqlExecutor;
  private readonly sql: BillingSql;
  private readonly dialect: "postgresql" | "mysql";

  public constructor(connectionString?: string) {
    const created = createExecutor(connectionString);
    this.db = created.db;
    this.sql = created.sql;
    this.dialect = created.dialect;
  }

  public async listRules(tenantId: string): Promise<BillingSplitRule[]> {
    try {
      const result = await this.db.query(
        `
          select *
          from billing_split_rules
          where tenant_id = $1
          order by effective_start desc, name asc
        `,
        [tenantId],
      );
      return result.rows.map((row) => this.mapRule(row));
    } catch {
      return [];
    }
  }

  public async getRule(tenantId: string, id: string): Promise<BillingSplitRule | null> {
    try {
      const result = await this.db.query(
        `select * from billing_split_rules where tenant_id = $1 and id = $2 limit 1`,
        [tenantId, id],
      );
      if (result.rowCount === 0) return null;
      return this.mapRule(result.rows[0]!);
    } catch {
      return null;
    }
  }

  public async createRule(input: BillingSplitRuleInput): Promise<BillingSplitRule> {
    const id = ulid();
    const params = [
      id,
      input.tenant_id,
      input.name,
      input.effective_start,
      input.effective_end ?? null,
      input.split_mode ?? "fixed_ratio",
      JSON.stringify(input.participants),
      input.billing_items ? JSON.stringify(input.billing_items) : null,
      input.enabled ?? true,
    ];
    await this.db.query(
      `
        insert into billing_split_rules
          (id, tenant_id, name, effective_start, effective_end, split_mode, participants, billing_items, enabled, created_at, updated_at)
        values ($1,$2,$3,$4,$5,$6,${this.sql.jsonCast("$7")},${this.sql.jsonCast("$8")},$9, ${this.sql.now}, ${this.sql.now})
        ${this.sql.returning}
      `,
      params,
    );
    const created = await this.getRule(input.tenant_id, id);
    if (!created) throw new Error("failed to create billing split rule");
    return created;
  }

  public async updateRule(
    tenantId: string,
    id: string,
    patch: Partial<Omit<BillingSplitRuleInput, "tenant_id">>,
  ): Promise<BillingSplitRule | null> {
    const fields: string[] = [];
    const params: Array<string | boolean | null> = [tenantId, id];
    if (patch.name != null) {
      params.push(patch.name);
      fields.push(`name = $${params.length}`);
    }
    if (patch.effective_start != null) {
      params.push(patch.effective_start);
      fields.push(`effective_start = $${params.length}`);
    }
    if (patch.effective_end !== undefined) {
      params.push(patch.effective_end ?? null);
      fields.push(`effective_end = $${params.length}`);
    }
    if (patch.split_mode != null) {
      params.push(patch.split_mode);
      fields.push(`split_mode = $${params.length}`);
    }
    if (patch.participants != null) {
      params.push(JSON.stringify(patch.participants));
      fields.push(`participants = ${this.sql.jsonCast(`$${params.length}`)}`);
    }
    if (patch.billing_items !== undefined) {
      params.push(patch.billing_items ? JSON.stringify(patch.billing_items) : null);
      fields.push(`billing_items = ${this.sql.jsonCast(`$${params.length}`)}`);
    }
    if (patch.enabled != null) {
      params.push(patch.enabled);
      fields.push(`enabled = $${params.length}`);
    }
    if (fields.length === 0) {
      return this.getRule(tenantId, id);
    }
    fields.push(`updated_at = ${this.sql.now}`);
    await this.db.query(
      `update billing_split_rules set ${fields.join(", ")} where tenant_id = $1 and id = $2`,
      params,
    );
    return this.getRule(tenantId, id);
  }

  public async deleteRule(tenantId: string, id: string): Promise<boolean> {
    const result = await this.db.query(
      `delete from billing_split_rules where tenant_id = $1 and id = $2`,
      [tenantId, id],
    );
    return result.rowCount > 0;
  }

  public async findActiveRule(tenantId: string, timeBucketIso: string): Promise<BillingSplitRule | null> {
    try {
      const result = await this.db.query(
        `
          select *
          from billing_split_rules
          where tenant_id = $1
            and enabled = true
            and effective_start <= $2
            and (effective_end is null or effective_end >= $2)
          order by effective_start desc, updated_at desc
          limit 1
        `,
        [tenantId, timeBucketIso],
      );
      if (result.rowCount === 0) return null;
      return this.mapRule(result.rows[0]!);
    } catch {
      return null;
    }
  }

  private mapRule(row: Record<string, unknown>): BillingSplitRule {
    return {
      id: String(row.id),
      tenant_id: String(row.tenant_id),
      name: String(row.name),
      effective_start:
        row.effective_start instanceof Date
          ? row.effective_start.toISOString()
          : String(row.effective_start),
      effective_end:
        row.effective_end == null
          ? null
          : row.effective_end instanceof Date
            ? row.effective_end.toISOString()
            : String(row.effective_end),
      split_mode: (row.split_mode === "by_billing_item" ? "by_billing_item" : "fixed_ratio") as BillingSplitRule["split_mode"],
      participants: parseParticipants(row.participants),
      billing_items: Array.isArray(row.billing_items)
        ? row.billing_items.filter((item): item is string => typeof item === "string")
        : typeof row.billing_items === "string"
          ? (JSON.parse(row.billing_items) as string[])
          : null,
      enabled: Boolean(row.enabled),
      created_at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
      updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : String(row.updated_at),
    };
  }
}
