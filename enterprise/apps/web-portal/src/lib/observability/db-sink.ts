import { ulid } from "ulid";
import { portalRequestLogs as pgPortalRequestLogs } from "@agenticx/db-schema";
import { portalRequestLogs as mysqlPortalRequestLogs } from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";

export type PortalLogLevel = "debug" | "info" | "warn" | "error";

export type PortalLogRow = {
  tenant_id: string;
  log_time: Date;
  level: PortalLogLevel;
  event: string;
  trace_id?: string;
  user_id?: string;
  session_id?: string;
  route?: string;
  status?: number;
  duration_ms?: number;
  error_name?: string;
  error_message?: string;
  error_stack?: string;
  fields?: Record<string, unknown>;
};

const MAX_QUEUE = 1000;
const BATCH_SIZE = 50;
const FLUSH_INTERVAL_MS = 2000;
const DROP_REPORT_INTERVAL_MS = 60_000;
const MAX_CONSECUTIVE_FAILURES = 3;

const LEVEL_ORDER: Record<PortalLogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export type InsertBatchFn = (rows: PortalLogRow[]) => Promise<void>;

type SinkState = {
  queue: PortalLogRow[];
  droppedCount: number;
  consecutiveFailures: number;
  disabled: boolean;
  flushTimer: ReturnType<typeof setTimeout> | null;
  dropReportTimer: ReturnType<typeof setTimeout> | null;
  flushing: boolean;
  insertBatch: InsertBatchFn;
};

function parseOnOff(raw: string | undefined, fallback: "on" | "off"): "on" | "off" {
  const value = (raw ?? fallback).trim().toLowerCase();
  return value === "on" ? "on" : "off";
}

function parseLevel(raw: string | undefined, fallback: PortalLogLevel): PortalLogLevel {
  const value = (raw ?? fallback).trim().toLowerCase();
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return fallback;
}

function sinkEnabled(): boolean {
  return parseOnOff(process.env.PORTAL_LOG_DB_SINK, "off") === "on";
}

function minDbLevel(): PortalLogLevel {
  return parseLevel(process.env.PORTAL_LOG_DB_MIN_LEVEL, "info");
}

function levelRank(level: PortalLogLevel): number {
  return LEVEL_ORDER[level] ?? LEVEL_ORDER.info;
}

async function defaultInsertBatch(rows: PortalLogRow[]): Promise<void> {
  const config = resolveDatabaseConfig();
  const values = rows.map((row) => ({
    id: ulid(),
    tenantId: row.tenant_id,
    logTime: row.log_time,
    level: row.level,
    event: row.event,
    traceId: row.trace_id ?? null,
    userId: row.user_id ?? null,
    sessionId: row.session_id ?? null,
    route: row.route ?? null,
    status: row.status ?? null,
    durationMs: row.duration_ms ?? null,
    errorName: row.error_name ?? null,
    errorMessage: row.error_message ?? null,
    errorStack: row.error_stack ?? null,
    fields: row.fields ?? null,
  }));

  switch (config.dialect) {
    case "postgresql": {
      const db = getIamDb();
      await db.insert(pgPortalRequestLogs).values(values);
      return;
    }
    case "mysql": {
      const { raw: db } = await createMysqlDb(config);
      await db.insert(mysqlPortalRequestLogs).values(values);
      return;
    }
    default: {
      const exhaustive: never = config;
      throw new Error(`Unsupported database config: ${JSON.stringify(exhaustive)}`);
    }
  }
}

function createState(insertBatch: InsertBatchFn = defaultInsertBatch): SinkState {
  return {
    queue: [],
    droppedCount: 0,
    consecutiveFailures: 0,
    disabled: false,
    flushTimer: null,
    dropReportTimer: null,
    flushing: false,
    insertBatch,
  };
}

let state = createState();

function ensureDropReportTimer(): void {
  if (state.dropReportTimer != null) return;
  state.dropReportTimer = setInterval(() => {
    if (state.droppedCount > 0) {
      console.error(
        JSON.stringify({
          ts: new Date().toISOString(),
          level: "warn",
          event: "portal_log_sink.dropped",
          dropped_count: state.droppedCount,
        }),
      );
      state.droppedCount = 0;
    }
  }, DROP_REPORT_INTERVAL_MS);
  // Allow process to exit without waiting on this timer in Node.
  if (typeof state.dropReportTimer === "object" && state.dropReportTimer && "unref" in state.dropReportTimer) {
    (state.dropReportTimer as NodeJS.Timeout).unref();
  }
}

function scheduleFlush(): void {
  if (state.flushTimer != null) return;
  state.flushTimer = setTimeout(() => {
    state.flushTimer = null;
    void flushQueue();
  }, FLUSH_INTERVAL_MS);
  if (typeof state.flushTimer === "object" && state.flushTimer && "unref" in state.flushTimer) {
    (state.flushTimer as NodeJS.Timeout).unref();
  }
}

function trimQueue(): void {
  while (state.queue.length > MAX_QUEUE) {
    let dropIdx = -1;
    for (let i = 0; i < state.queue.length; i += 1) {
      const level = state.queue[i]?.level;
      if (level === "info" || level === "debug") {
        dropIdx = i;
        break;
      }
    }
    if (dropIdx < 0) dropIdx = 0;
    state.queue.splice(dropIdx, 1);
    state.droppedCount += 1;
  }
}

async function flushQueue(): Promise<void> {
  if (state.disabled || state.flushing || state.queue.length === 0) return;
  state.flushing = true;
  try {
    while (state.queue.length > 0 && !state.disabled) {
      const batch = state.queue.splice(0, BATCH_SIZE);
      try {
        await state.insertBatch(batch);
        state.consecutiveFailures = 0;
      } catch (error) {
        state.consecutiveFailures += 1;
        console.error(
          JSON.stringify({
            ts: new Date().toISOString(),
            level: "error",
            event: "portal_log_sink.flush_failed",
            error_message: error instanceof Error ? error.message : String(error),
            batch_size: batch.length,
            consecutive_failures: state.consecutiveFailures,
          }),
        );
        // Drop the failed batch; do not re-enqueue (avoid loops).
        if (state.consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
          state.disabled = true;
          if (state.flushTimer != null) {
            clearTimeout(state.flushTimer);
            state.flushTimer = null;
          }
          break;
        }
      }
    }
  } finally {
    state.flushing = false;
  }
}

/** Sync enqueue — never awaits, never throws. */
export function enqueueLog(row: PortalLogRow): void {
  try {
    if (!sinkEnabled() || state.disabled) return;
    if (levelRank(row.level) < levelRank(minDbLevel())) return;
    if (!row.tenant_id?.trim() || !row.event?.trim()) return;

    state.queue.push({
      ...row,
      tenant_id: row.tenant_id.trim(),
      event: row.event.trim(),
      log_time: row.log_time instanceof Date ? row.log_time : new Date(),
    });
    trimQueue();
    ensureDropReportTimer();

    if (state.queue.length >= BATCH_SIZE) {
      if (state.flushTimer != null) {
        clearTimeout(state.flushTimer);
        state.flushTimer = null;
      }
      void flushQueue();
      return;
    }
    scheduleFlush();
  } catch {
    // Never surface sink failures to callers.
  }
}

/** Test-only: replace insert implementation and clear queue/timers. */
export function __resetDbSinkForTests(options?: { insertBatch?: InsertBatchFn }): void {
  if (state.flushTimer != null) clearTimeout(state.flushTimer);
  if (state.dropReportTimer != null) clearInterval(state.dropReportTimer);
  state = createState(options?.insertBatch ?? defaultInsertBatch);
}

/** Test-only: force a flush. */
export async function __flushDbSinkForTests(): Promise<void> {
  if (state.flushTimer != null) {
    clearTimeout(state.flushTimer);
    state.flushTimer = null;
  }
  await flushQueue();
}

/** Test-only inspection helpers. */
export function __getDbSinkQueueForTests(): PortalLogRow[] {
  return [...state.queue];
}

export function __isDbSinkDisabledForTests(): boolean {
  return state.disabled;
}
