/**
 * Deep-research run persistence (PG / MySQL / in-memory fallback).
 */

import { enterpriseDeepResearchRuns as pgTable } from "@agenticx/db-schema";
import { enterpriseDeepResearchRuns as mysqlTable } from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import type { DeepResearchEvent } from "@agenticx/sdk-ts";
import { and, desc, eq, inArray, lt, sql } from "drizzle-orm";
import type { Citation } from "./registry";

export const MAX_EVENTS_PER_RUN = 400;
/** 事件批量落库间隔，避免每条事件一次 UPDATE。 */
export const RUN_FLUSH_INTERVAL_MS = 1_500;

export type DeepResearchRunStatus =
  | "running"
  | "awaiting_clarify"
  | "completed"
  | "failed"
  | "cancelled";

const TERMINAL_STATUSES: ReadonlySet<DeepResearchRunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

const ACTIVE_STATUSES: DeepResearchRunStatus[] = ["running", "awaiting_clarify"];

const NEVER_DROP_TYPES = new Set<DeepResearchEvent["type"]>(["run_started", "clarify"]);

export type RunRecord = {
  runId: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  status: DeepResearchRunStatus;
  phase: string;
  topic: string;
  events: DeepResearchEvent[];
  reportMarkdown: string;
  citations: Citation[];
  errorMessage?: string;
  eventSeq: number;
  createdAt: string;
  updatedAt: string;
};

export type RunStore = {
  create(input: {
    runId: string;
    tenantId: string;
    userId: string;
    sessionId: string;
    topic: string;
  }): Promise<RunRecord>;
  /** 追加事件并可选更新 status/phase；超过 MAX_EVENTS_PER_RUN 时丢弃最旧的 lane_progress。 */
  appendEvents(
    runId: string,
    events: DeepResearchEvent[],
    patch?: { status?: DeepResearchRunStatus; phase?: string },
  ): Promise<void>;
  appendReport(runId: string, chunk: string): Promise<void>;
  setCitations(runId: string, citations: Citation[]): Promise<void>;
  finish(
    runId: string,
    status: "completed" | "failed" | "cancelled",
    errorMessage?: string,
  ): Promise<void>;
  get(tenantId: string, userId: string, runId: string): Promise<RunRecord | null>;
  listActive(tenantId: string, userId: string, sessionId?: string): Promise<RunRecord[]>;
  /** Most recently updated run for a session (any status) — used to rehydrate workbench after refresh. */
  getLatestBySession(
    tenantId: string,
    userId: string,
    sessionId: string,
  ): Promise<RunRecord | null>;
  /** Mark stale non-terminal runs as failed (process restart safety net). */
  reapStaleRuns(olderThanMs: number): Promise<number>;
};

export type RunWriter = {
  push(event: DeepResearchEvent, patch?: { status?: DeepResearchRunStatus; phase?: string }): void;
  pushReport(chunk: string): void;
  flush(): Promise<void>;
  finish(
    status: "completed" | "failed" | "cancelled",
    errorMessage?: string,
  ): Promise<void>;
};

function isRunStatus(value: string): value is DeepResearchRunStatus {
  return (
    value === "running" ||
    value === "awaiting_clarify" ||
    value === "completed" ||
    value === "failed" ||
    value === "cancelled"
  );
}

function asEvents(value: unknown): DeepResearchEvent[] {
  if (!Array.isArray(value)) return [];
  return value as DeepResearchEvent[];
}

function asCitations(value: unknown): Citation[] {
  if (!Array.isArray(value)) return [];
  return value as Citation[];
}

function toIso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function mapRow(row: {
  runId: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  status: string;
  phase: string;
  topic: string;
  events: unknown;
  reportMarkdown: string;
  citations: unknown;
  errorMessage: string | null;
  eventSeq: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}): RunRecord {
  return {
    runId: row.runId,
    tenantId: row.tenantId,
    userId: row.userId,
    sessionId: row.sessionId,
    status: isRunStatus(row.status) ? row.status : "running",
    phase: row.phase,
    topic: row.topic,
    events: asEvents(row.events),
    reportMarkdown: row.reportMarkdown ?? "",
    citations: asCitations(row.citations),
    errorMessage: row.errorMessage ?? undefined,
    eventSeq: Number(row.eventSeq) || 0,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

/**
 * Report body long enough that synthesize clearly produced a usable draft.
 * Used when the handler died after writing reportMarkdown / artifacts but before
 * flushing final-report artifact events + `finish()`.
 */
export const FINISHED_REPORT_MARKDOWN_MIN_CHARS = 2_000;

/**
 * True when the run already delivered a terminal outcome but status may still be
 * `running` (e.g. Next.js killed the handler after client disconnect mid-wrap-up).
 */
export function runLooksFinished(row: Pick<RunRecord, "phase" | "events" | "reportMarkdown">): boolean {
  if (row.phase === "done") return true;
  if (row.events.some((e) => e.type === "phase" && e.phase === "done")) return true;
  const hasFinalReportArtifact = row.events.some(
    (e) =>
      e.type === "artifact" &&
      (e.kind === "report" ||
        (typeof e.path === "string" && e.path.includes("final-report"))),
  );
  if (hasFinalReportArtifact) return true;
  // Artifact events may be missing even though reportMarkdown was flushed.
  if (row.reportMarkdown.trim().length >= FINISHED_REPORT_MARKDOWN_MIN_CHARS) return true;
  return false;
}

/**
 * Trim events when over MAX_EVENTS_PER_RUN.
 * Prefer dropping oldest lane_progress, then narrative, then lane_sources;
 * never drop run_started/clarify.
 */
export function trimEvents(events: DeepResearchEvent[]): DeepResearchEvent[] {
  if (events.length <= MAX_EVENTS_PER_RUN) return events;
  const next = [...events];
  const dropOldestOfType = (type: DeepResearchEvent["type"]): boolean => {
    const idx = next.findIndex((e) => e.type === type && !NEVER_DROP_TYPES.has(e.type));
    if (idx < 0) return false;
    next.splice(idx, 1);
    return true;
  };
  while (next.length > MAX_EVENTS_PER_RUN) {
    if (dropOldestOfType("lane_progress")) continue;
    if (dropOldestOfType("narrative")) continue;
    if (dropOldestOfType("lane_sources")) continue;
    // Last resort: drop oldest non-critical event
    const idx = next.findIndex((e) => !NEVER_DROP_TYPES.has(e.type));
    if (idx < 0) break;
    next.splice(idx, 1);
  }
  return next;
}

function createMemoryStore(): RunStore {
  const bucket = new Map<string, RunRecord>();

  return {
    async create(input) {
      const now = new Date().toISOString();
      const row: RunRecord = {
        runId: input.runId,
        tenantId: input.tenantId,
        userId: input.userId,
        sessionId: input.sessionId,
        status: "running",
        phase: "recon",
        topic: input.topic,
        events: [],
        reportMarkdown: "",
        citations: [],
        eventSeq: 0,
        createdAt: now,
        updatedAt: now,
      };
      bucket.set(input.runId, row);
      return { ...row, events: [], citations: [] };
    },

    async appendEvents(runId, events, patch) {
      const row = bucket.get(runId);
      if (!row) return;
      if (TERMINAL_STATUSES.has(row.status)) return;
      if (events.length > 0) {
        row.events = trimEvents([...row.events, ...events]);
        row.eventSeq += events.length;
      }
      if (patch?.status) row.status = patch.status;
      if (patch?.phase) row.phase = patch.phase;
      row.updatedAt = new Date().toISOString();
    },

    async appendReport(runId, chunk) {
      if (!chunk) return;
      const row = bucket.get(runId);
      if (!row) return;
      if (TERMINAL_STATUSES.has(row.status)) return;
      row.reportMarkdown = `${row.reportMarkdown}${chunk}`;
      row.updatedAt = new Date().toISOString();
    },

    async setCitations(runId, citations) {
      const row = bucket.get(runId);
      if (!row) return;
      row.citations = citations;
      row.updatedAt = new Date().toISOString();
    },

    async finish(runId, status, errorMessage) {
      const row = bucket.get(runId);
      if (!row) return;
      if (TERMINAL_STATUSES.has(row.status)) return;
      row.status = status;
      if (errorMessage !== undefined) row.errorMessage = errorMessage;
      row.phase = "done";
      row.updatedAt = new Date().toISOString();
    },

    async get(tenantId, userId, runId) {
      const row = bucket.get(runId);
      if (!row) return null;
      if (row.tenantId !== tenantId || row.userId !== userId) return null;
      return {
        ...row,
        events: [...row.events],
        citations: [...row.citations],
      };
    },

    async listActive(tenantId, userId, sessionId) {
      return [...bucket.values()]
        .filter(
          (row) =>
            row.tenantId === tenantId &&
            row.userId === userId &&
            ACTIVE_STATUSES.includes(row.status) &&
            (sessionId === undefined || row.sessionId === sessionId),
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
        .map((row) => ({
          ...row,
          events: [...row.events],
          citations: [...row.citations],
        }));
    },

    async getLatestBySession(tenantId, userId, sessionId) {
      const rows = [...bucket.values()]
        .filter(
          (row) =>
            row.tenantId === tenantId &&
            row.userId === userId &&
            row.sessionId === sessionId,
        )
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      const row = rows[0];
      if (!row) return null;
      return {
        ...row,
        events: [...row.events],
        citations: [...row.citations],
      };
    },

    async reapStaleRuns(olderThanMs) {
      const cutoff = Date.now() - olderThanMs;
      let count = 0;
      for (const row of bucket.values()) {
        if (!ACTIVE_STATUSES.includes(row.status)) continue;
        if (Date.parse(row.updatedAt) >= cutoff) continue;
        row.status = "failed";
        row.errorMessage = "stale run reaped after process restart";
        row.phase = "done";
        row.updatedAt = new Date().toISOString();
        count += 1;
      }
      return count;
    },
  };
}

function createSqlStore(): RunStore {
  return {
    async create(input) {
      const now = new Date();
      const config = resolveDatabaseConfig();
      const values = {
        runId: input.runId,
        tenantId: input.tenantId,
        userId: input.userId,
        sessionId: input.sessionId,
        status: "running" as const,
        phase: "recon",
        topic: input.topic,
        events: [] as unknown[],
        reportMarkdown: "",
        citations: [] as unknown[],
        errorMessage: null as string | null,
        eventSeq: 0,
        createdAt: now,
        updatedAt: now,
      };

      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        await db.insert(mysqlTable).values(values);
      } else {
        const db = getIamDb();
        await db.insert(pgTable).values(values);
      }

      return {
        runId: input.runId,
        tenantId: input.tenantId,
        userId: input.userId,
        sessionId: input.sessionId,
        status: "running",
        phase: "recon",
        topic: input.topic,
        events: [],
        reportMarkdown: "",
        citations: [],
        eventSeq: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
    },

    async appendEvents(runId, events, patch) {
      const config = resolveDatabaseConfig();
      const now = new Date();

      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        const rows = await db
          .select()
          .from(mysqlTable)
          .where(eq(mysqlTable.runId, runId))
          .limit(1);
        const current = rows[0];
        if (!current) return;
        if (TERMINAL_STATUSES.has(current.status as DeepResearchRunStatus)) return;
        const merged =
          events.length > 0
            ? trimEvents([...asEvents(current.events), ...events])
            : asEvents(current.events);
        await db
          .update(mysqlTable)
          .set({
            events: merged,
            eventSeq: Number(current.eventSeq) + events.length,
            ...(patch?.status ? { status: patch.status } : {}),
            ...(patch?.phase ? { phase: patch.phase } : {}),
            updatedAt: now,
          })
          .where(eq(mysqlTable.runId, runId));
        return;
      }

      const db = getIamDb();
      const rows = await db.select().from(pgTable).where(eq(pgTable.runId, runId)).limit(1);
      const current = rows[0];
      if (!current) return;
      if (TERMINAL_STATUSES.has(current.status as DeepResearchRunStatus)) return;
      const merged =
        events.length > 0
          ? trimEvents([...asEvents(current.events), ...events])
          : asEvents(current.events);
      await db
        .update(pgTable)
        .set({
          events: merged,
          eventSeq: Number(current.eventSeq) + events.length,
          ...(patch?.status ? { status: patch.status } : {}),
          ...(patch?.phase ? { phase: patch.phase } : {}),
          updatedAt: now,
        })
        .where(eq(pgTable.runId, runId));
    },

    async appendReport(runId, chunk) {
      if (!chunk) return;
      const config = resolveDatabaseConfig();
      const now = new Date();

      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        const rows = await db
          .select({ status: mysqlTable.status, reportMarkdown: mysqlTable.reportMarkdown })
          .from(mysqlTable)
          .where(eq(mysqlTable.runId, runId))
          .limit(1);
        const current = rows[0];
        if (!current) return;
        if (TERMINAL_STATUSES.has(current.status as DeepResearchRunStatus)) return;
        await db
          .update(mysqlTable)
          .set({
            reportMarkdown: `${current.reportMarkdown ?? ""}${chunk}`,
            updatedAt: now,
          })
          .where(eq(mysqlTable.runId, runId));
        return;
      }

      const db = getIamDb();
      const rows = await db
        .select({ status: pgTable.status, reportMarkdown: pgTable.reportMarkdown })
        .from(pgTable)
        .where(eq(pgTable.runId, runId))
        .limit(1);
      const current = rows[0];
      if (!current) return;
      if (TERMINAL_STATUSES.has(current.status as DeepResearchRunStatus)) return;
      await db
        .update(pgTable)
        .set({
          reportMarkdown: sql`${pgTable.reportMarkdown} || ${chunk}`,
          updatedAt: now,
        })
        .where(eq(pgTable.runId, runId));
    },

    async setCitations(runId, citations) {
      const config = resolveDatabaseConfig();
      const now = new Date();
      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        await db
          .update(mysqlTable)
          .set({ citations, updatedAt: now })
          .where(eq(mysqlTable.runId, runId));
        return;
      }
      const db = getIamDb();
      await db
        .update(pgTable)
        .set({ citations, updatedAt: now })
        .where(eq(pgTable.runId, runId));
    },

    async finish(runId, status, errorMessage) {
      const config = resolveDatabaseConfig();
      const now = new Date();
      const set = {
        status,
        phase: "done",
        updatedAt: now,
        ...(errorMessage !== undefined ? { errorMessage } : {}),
      };

      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        const rows = await db
          .select({ status: mysqlTable.status })
          .from(mysqlTable)
          .where(eq(mysqlTable.runId, runId))
          .limit(1);
        if (!rows[0] || TERMINAL_STATUSES.has(rows[0].status as DeepResearchRunStatus)) return;
        await db.update(mysqlTable).set(set).where(eq(mysqlTable.runId, runId));
        return;
      }

      const db = getIamDb();
      const rows = await db
        .select({ status: pgTable.status })
        .from(pgTable)
        .where(eq(pgTable.runId, runId))
        .limit(1);
      if (!rows[0] || TERMINAL_STATUSES.has(rows[0].status as DeepResearchRunStatus)) return;
      await db.update(pgTable).set(set).where(eq(pgTable.runId, runId));
    },

    async get(tenantId, userId, runId) {
      const config = resolveDatabaseConfig();
      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        const rows = await db
          .select()
          .from(mysqlTable)
          .where(
            and(
              eq(mysqlTable.runId, runId),
              eq(mysqlTable.tenantId, tenantId),
              eq(mysqlTable.userId, userId),
            ),
          )
          .limit(1);
        return rows[0] ? mapRow(rows[0]) : null;
      }
      const db = getIamDb();
      const rows = await db
        .select()
        .from(pgTable)
        .where(
          and(
            eq(pgTable.runId, runId),
            eq(pgTable.tenantId, tenantId),
            eq(pgTable.userId, userId),
          ),
        )
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async listActive(tenantId, userId, sessionId) {
      const config = resolveDatabaseConfig();
      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        const rows = await db
          .select()
          .from(mysqlTable)
          .where(
            and(
              eq(mysqlTable.tenantId, tenantId),
              eq(mysqlTable.userId, userId),
              inArray(mysqlTable.status, ACTIVE_STATUSES),
              ...(sessionId ? [eq(mysqlTable.sessionId, sessionId)] : []),
            ),
          );
        return rows
          .map(mapRow)
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      }
      const db = getIamDb();
      const rows = await db
        .select()
        .from(pgTable)
        .where(
          and(
            eq(pgTable.tenantId, tenantId),
            eq(pgTable.userId, userId),
            inArray(pgTable.status, ACTIVE_STATUSES),
            ...(sessionId ? [eq(pgTable.sessionId, sessionId)] : []),
          ),
        );
      return rows.map(mapRow).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async getLatestBySession(tenantId, userId, sessionId) {
      const config = resolveDatabaseConfig();
      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        const rows = await db
          .select()
          .from(mysqlTable)
          .where(
            and(
              eq(mysqlTable.tenantId, tenantId),
              eq(mysqlTable.userId, userId),
              eq(mysqlTable.sessionId, sessionId),
            ),
          )
          .orderBy(desc(mysqlTable.updatedAt))
          .limit(1);
        return rows[0] ? mapRow(rows[0]) : null;
      }
      const db = getIamDb();
      const rows = await db
        .select()
        .from(pgTable)
        .where(
          and(
            eq(pgTable.tenantId, tenantId),
            eq(pgTable.userId, userId),
            eq(pgTable.sessionId, sessionId),
          ),
        )
        .orderBy(desc(pgTable.updatedAt))
        .limit(1);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async reapStaleRuns(olderThanMs) {
      const cutoff = new Date(Date.now() - olderThanMs);
      const config = resolveDatabaseConfig();
      const set = {
        status: "failed" as const,
        phase: "done",
        errorMessage: "stale run reaped after process restart",
        updatedAt: new Date(),
      };

      if (config.dialect === "mysql") {
        const { raw: db } = await createMysqlDb(config);
        const rows = await db
          .select({ runId: mysqlTable.runId })
          .from(mysqlTable)
          .where(
            and(inArray(mysqlTable.status, ACTIVE_STATUSES), lt(mysqlTable.updatedAt, cutoff)),
          );
        for (const row of rows) {
          await db.update(mysqlTable).set(set).where(eq(mysqlTable.runId, row.runId));
        }
        return rows.length;
      }

      const db = getIamDb();
      const rows = await db
        .select({ runId: pgTable.runId })
        .from(pgTable)
        .where(and(inArray(pgTable.status, ACTIVE_STATUSES), lt(pgTable.updatedAt, cutoff)));
      for (const row of rows) {
        await db.update(pgTable).set(set).where(eq(pgTable.runId, row.runId));
      }
      return rows.length;
    },
  };
}

/** Events appended since lastEventSeq (tail slice; safe when oldest noise was trimmed). */
export function newEventsSince(record: RunRecord, lastEventSeq: number): DeepResearchEvent[] {
  const delta = record.eventSeq - lastEventSeq;
  if (delta <= 0) return [];
  return record.events.slice(-Math.min(delta, record.events.length));
}

export function createRunWriter(store: RunStore, runId: string): RunWriter {
  let pendingEvents: DeepResearchEvent[] = [];
  let pendingPatch: { status?: DeepResearchRunStatus; phase?: string } | undefined;
  let pendingReport = "";
  let timer: ReturnType<typeof setTimeout> | null = null;
  let flushChain: Promise<void> = Promise.resolve();

  const schedule = () => {
    if (timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, RUN_FLUSH_INTERVAL_MS);
  };

  const flush = async (): Promise<void> => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    const events = pendingEvents;
    const patch = pendingPatch;
    const report = pendingReport;
    pendingEvents = [];
    pendingPatch = undefined;
    pendingReport = "";
    if (events.length === 0 && !patch && !report) return;

    flushChain = flushChain.then(async () => {
      // Report chunks first: a terminal status patch in the same flush must not
      // block appendReport (finish / phase=done often lands with the last summary).
      if (report) {
        await store.appendReport(runId, report);
      }
      if (events.length > 0 || patch) {
        await store.appendEvents(runId, events, patch);
      }
    });
    await flushChain;
  };

  return {
    push(event, patch) {
      pendingEvents.push(event);
      const nextPatch = { ...pendingPatch };
      if (patch?.status) nextPatch.status = patch.status;
      if (patch?.phase) nextPatch.phase = patch.phase;
      if (event.type === "phase" && typeof event.phase === "string") {
        nextPatch.phase = event.phase;
      }
      if (Object.keys(nextPatch).length > 0) pendingPatch = nextPatch;
      schedule();
    },
    pushReport(chunk) {
      if (!chunk) return;
      pendingReport += chunk;
      schedule();
    },
    flush,
    async finish(status, errorMessage) {
      await flush();
      await store.finish(runId, status, errorMessage);
    },
  };
}

export function createRunStore(): RunStore {
  if (!process.env.DATABASE_URL?.trim()) return createMemoryStore();
  try {
    resolveDatabaseConfig();
    return createSqlStore();
  } catch {
    return createMemoryStore();
  }
}

export const defaultRunStore = createRunStore();

/** Test helper — isolated in-memory bucket (safe for parallel tests). */
export function createMemoryRunStore(): RunStore {
  return createMemoryStore();
}
