import { resolveDatabaseConfig } from "@agenticx/iam-core";

import type {
  AgentQuotaWindowTotals,
  AgentQuotaWindows,
  AgentUsageGroupKey,
  AgentUsageQueryInput,
  AgentUsageRow,
} from "../types";
import {
  createMysqlExecutor,
  createPostgresqlExecutor,
  mysqlMeteringSql,
  postgresqlMeteringSql,
  type MeteringSqlBuilder,
  type SqlExecutor,
} from "./sql";

export type { AgentQuotaWindowTotals, AgentQuotaWindows, AgentUsageGroupKey, AgentUsageQueryInput, AgentUsageRow };

const DEFAULT_QUOTA_TIME_ZONE = "Asia/Shanghai";

export class QuotaTimeZoneError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QuotaTimeZoneError";
  }
}

/** IANA zone used for quota periods. Empty or unset means Asia/Shanghai. */
export function resolveQuotaTimeZone(raw?: string): string {
  const name = (raw ?? "").trim() || DEFAULT_QUOTA_TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: name }).format(new Date());
  } catch {
    throw new QuotaTimeZoneError(`MA_QUOTA_TIMEZONE: unknown IANA timezone ${name}`);
  }
  return name;
}

type LocalDate = { year: number; month: number; day: number };

function localParts(instant: Date, timeZone: string): LocalDate & { weekday: number } {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  const weekdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const weekday = weekdays.indexOf(map.weekday ?? "");
  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    weekday: weekday < 0 ? 0 : weekday,
  };
}

function offsetMinutes(instant: Date, timeZone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const map: Record<string, string> = {};
  for (const part of fmt.formatToParts(instant)) {
    if (part.type !== "literal") map[part.type] = part.value;
  }
  let hour = Number(map.hour);
  let day = Number(map.day);
  if (hour === 24) {
    hour = 0;
    day += 1;
  }
  const asUtc = Date.UTC(Number(map.year), Number(map.month) - 1, day, hour, Number(map.minute), Number(map.second));
  return Math.round((asUtc - instant.getTime()) / 60_000);
}

function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = new Date(Date.UTC(year, month - 1, day, 0, 0, 0));
  const first = offsetMinutes(guess, timeZone);
  let utc = new Date(guess.getTime() - first * 60_000);
  const second = offsetMinutes(utc, timeZone);
  if (second !== first) utc = new Date(guess.getTime() - second * 60_000);
  return utc;
}

function addCalendarDays(date: LocalDate, delta: number): LocalDate {
  const utc = new Date(Date.UTC(date.year, date.month - 1, date.day + delta));
  return { year: utc.getUTCFullYear(), month: utc.getUTCMonth() + 1, day: utc.getUTCDate() };
}

/** UTC instants of the local day, Monday, and month containing ``now``. */
export function agentQuotaWindowStarts(now: Date, timeZone = resolveQuotaTimeZone()): { day: Date; week: Date; month: Date } {
  const zone = resolveQuotaTimeZone(timeZone);
  const parts = localParts(now, zone);
  const weekDate = addCalendarDays(parts, -parts.weekday);
  return {
    day: zonedMidnight(parts.year, parts.month, parts.day, zone),
    week: zonedMidnight(weekDate.year, weekDate.month, weekDate.day, zone),
    month: zonedMidnight(parts.year, parts.month, 1, zone),
  };
}

export function agentQuotaWindowLabels(now: Date, timeZone = resolveQuotaTimeZone()): AgentQuotaWindows {
  const zone = resolveQuotaTimeZone(timeZone);
  const windows = agentQuotaWindowStarts(now, zone);
  return {
    day: windows.day.toISOString(),
    week: windows.week.toISOString(),
    month: windows.month.toISOString(),
  };
}

function formatDay(value: unknown, timeZone: string): string {
  if (value instanceof Date) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(value);
  }
  const text = String(value ?? "");
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  return match?.[1] ?? text;
}

export class AgentUsageService {
  private readonly database: SqlExecutor;
  private readonly sql: MeteringSqlBuilder;
  private readonly timeZone: string;

  public constructor(opts?: {
    executor?: SqlExecutor;
    sql?: MeteringSqlBuilder;
    connectionString?: string;
    timeZone?: string;
  }) {
    this.timeZone = resolveQuotaTimeZone(opts?.timeZone ?? process.env.MA_QUOTA_TIMEZONE);
    if (opts?.executor) {
      this.database = opts.executor;
      this.sql = opts.sql ?? postgresqlMeteringSql;
      return;
    }
    const config = resolveDatabaseConfig({
      ...process.env,
      ...(opts?.connectionString ? { DATABASE_URL: opts.connectionString } : {}),
    });
    this.database = config.dialect === "mysql" ? createMysqlExecutor(config.url) : createPostgresqlExecutor(config.url);
    this.sql = config.dialect === "mysql" ? mysqlMeteringSql : postgresqlMeteringSql;
  }

  private placeholder(params: unknown[]): string {
    return this.sql.placeholder(params.length + 1);
  }

  private pushIn(field: string, values: string[] | undefined, where: string[], params: Array<string | number | Date>): void {
    if (!values || values.length === 0) return;
    const placeholders = values.map((value) => {
      const token = this.placeholder(params);
      params.push(value);
      return token;
    });
    where.push(`${field} in (${placeholders.join(",")})`);
  }

  private dayBucket(column: string, placeholder: string): string {
    if (this.sql.dialect === "mysql") {
      return `DATE_FORMAT(CONVERT_TZ(${column}, '+00:00', ${placeholder}), '%Y-%m-%d')`;
    }
    return `to_char(${column} AT TIME ZONE ${placeholder}, 'YYYY-MM-DD')`;
  }

  private dimension(key: AgentUsageGroupKey, params: Array<string | number | Date>): { select: string[]; group: string[] } {
    switch (key) {
      case "agent":
        return {
          select: ["u.agent_id AS agent", "a.display_name AS agent_name"],
          group: ["u.agent_id", "a.display_name"],
        };
      case "user":
        return { select: ["u.user_id AS user"], group: ["u.user_id"] };
      case "dept":
        return { select: ["usr.dept_id AS dept"], group: ["usr.dept_id"] };
      case "model":
        return { select: ["u.model AS model"], group: ["u.model"] };
      case "day": {
        const placeholder = this.placeholder(params);
        params.push(this.timeZone);
        const expr = this.dayBucket("u.created_at", placeholder);
        return { select: [`${expr} AS day`], group: [expr] };
      }
      default: {
        const unreachable: never = key;
        throw new Error(`unknown group ${String(unreachable)}`);
      }
    }
  }

  public async query(input: AgentUsageQueryInput): Promise<{ rows: AgentUsageRow[] }> {
    const params: Array<string | number | Date> = [];
    const selectDims: string[] = [];
    const groupDims: string[] = [];
    for (const key of input.group_by) {
      const piece = this.dimension(key, params);
      selectDims.push(...piece.select);
      groupDims.push(...piece.group);
    }
    const where = [`u.tenant_id = ${this.placeholder(params)}`];
    params.push(input.tenant_id);
    where.push(`u.created_at >= ${this.placeholder(params)}`);
    params.push(input.start);
    where.push(`u.created_at <= ${this.placeholder(params)}`);
    params.push(input.end);
    this.pushIn("u.agent_id", input.agent_id, where, params);
    this.pushIn("u.user_id", input.user_id, where, params);
    const sql = `
      SELECT ${selectDims.join(", ")},
        SUM(u.input_tokens) AS input_tokens,
        SUM(u.output_tokens) AS output_tokens,
        SUM(u.input_tokens + u.output_tokens) AS total_tokens,
        SUM(u.cache_read_input_tokens) AS cache_read_input_tokens,
        COUNT(*) AS requests,
        COUNT(DISTINCT u.session_id) AS sessions
      FROM ma_session_usage u
      LEFT JOIN users usr ON usr.id = u.user_id
      LEFT JOIN enterprise_agents a ON a.id = u.agent_id
      WHERE ${where.join(" AND ")}
      GROUP BY ${groupDims.join(", ")}
      ORDER BY total_tokens DESC
      LIMIT 1000
    `;
    try {
      const result = await this.database.query(sql, params);
      const rows = result.rows.map((row) => this.mapRow(row, input.group_by));
      return { rows };
    } catch (error) {
      console.error("agent usage query failed", error);
      return { rows: [] };
    }
  }

  private mapRow(row: Record<string, unknown>, groups: AgentUsageGroupKey[]): AgentUsageRow {
    const dims: Record<string, string | null> = {};
    for (const key of groups) {
      switch (key) {
        case "agent":
          dims.agent = row.agent == null ? null : String(row.agent);
          dims.agent_name = row.agent_name == null ? null : String(row.agent_name);
          break;
        case "user":
          dims.user = row.user == null ? null : String(row.user);
          break;
        case "dept":
          dims.dept = row.dept == null ? null : String(row.dept);
          break;
        case "model":
          dims.model = row.model == null ? null : String(row.model);
          break;
        case "day":
          dims.day = row.day == null ? null : formatDay(row.day, this.timeZone);
          break;
        default: {
          const unreachable: never = key;
          throw new Error(`unknown group ${String(unreachable)}`);
        }
      }
    }
    return {
      dims,
      input_tokens: Number(row.input_tokens ?? 0),
      output_tokens: Number(row.output_tokens ?? 0),
      total_tokens: Number(row.total_tokens ?? 0),
      cache_read_input_tokens: Number(row.cache_read_input_tokens ?? 0),
      requests: Number(row.requests ?? 0),
      sessions: Number(row.sessions ?? 0),
    };
  }

  public async windowTotals(
    tenantId: string,
    agentId: string,
    userIds: string[],
    now: Date = new Date(),
  ): Promise<Record<string, AgentQuotaWindowTotals>> {
    const empty: Record<string, AgentQuotaWindowTotals> = {};
    for (const id of userIds) empty[id] = { day: 0, week: 0, month: 0 };
    if (userIds.length === 0) return empty;
    const windows = agentQuotaWindowStarts(now, this.timeZone);
    const earliest = new Date(Math.min(windows.day.getTime(), windows.week.getTime(), windows.month.getTime()));
    const params: Array<string | number | Date> = [];
    const dayPh = this.placeholder(params);
    params.push(windows.day);
    const weekPh = this.placeholder(params);
    params.push(windows.week);
    const monthPh = this.placeholder(params);
    params.push(windows.month);
    const tenantPh = this.placeholder(params);
    params.push(tenantId);
    const agentPh = this.placeholder(params);
    params.push(agentId);
    const earliestPh = this.placeholder(params);
    params.push(earliest);
    const userPh = userIds.map((id) => {
      const token = this.placeholder(params);
      params.push(id);
      return token;
    });
    const sql = `
      SELECT u.user_id AS user_id,
        SUM(CASE WHEN u.created_at >= ${dayPh} THEN u.input_tokens + u.output_tokens ELSE 0 END) AS day,
        SUM(CASE WHEN u.created_at >= ${weekPh} THEN u.input_tokens + u.output_tokens ELSE 0 END) AS week,
        SUM(CASE WHEN u.created_at >= ${monthPh} THEN u.input_tokens + u.output_tokens ELSE 0 END) AS month
      FROM ma_session_usage u
      WHERE u.tenant_id = ${tenantPh}
        AND u.agent_id = ${agentPh}
        AND u.user_id IN (${userPh.join(",")})
        AND u.created_at >= ${earliestPh}
      GROUP BY u.user_id
    `;
    try {
      const result = await this.database.query(sql, params);
      for (const row of result.rows) {
        const id = String(row.user_id ?? "");
        if (!id || !(id in empty)) continue;
        empty[id] = {
          day: Number(row.day ?? 0),
          week: Number(row.week ?? 0),
          month: Number(row.month ?? 0),
        };
      }
      return empty;
    } catch (error) {
      console.error("agent quota window query failed", error);
      return empty;
    }
  }
}
