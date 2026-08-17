/**
 * Deep-research run persistence (PG / MySQL / in-memory fallback).
 *
 * Every mutation is multi-instance safe: event appends use `run_id + revision`
 * CAS, report chunks are concatenated inside SQL, and terminal status is decided
 * by a single conditional UPDATE. Clarify coordination lives in the same row so
 * an instance that waits and an instance that answers never need shared disk.
 */

import { enterpriseDeepResearchRuns as pgTable } from "@agenticx/db-schema";
import { enterpriseDeepResearchRuns as mysqlTable } from "@agenticx/db-schema/mysql";
import { createMysqlDb, getIamDb, resolveDatabaseConfig } from "@agenticx/iam-core";
import type { DeepResearchEvent } from "@agenticx/sdk-ts";
import { and, desc, eq, gt, inArray, isNull, lt, or, sql } from "drizzle-orm";
import type { Citation } from "./registry";

export const MAX_EVENTS_PER_RUN = 400;
/** 事件批量落库间隔，避免每条事件一次 UPDATE。 */
export const RUN_FLUSH_INTERVAL_MS = 1_500;
/** CAS 重试上限；耗尽后抛错，绝不静默丢事件。 */
export const MAX_RUN_CAS_ATTEMPTS = 8;

export type DeepResearchRunStatus =
  | "running"
  | "awaiting_clarify"
  | "completed"
  | "failed"
  | "cancelled";

export type DeepResearchTerminalStatus = "completed" | "failed" | "cancelled";

const TERMINAL_STATUSES: ReadonlySet<DeepResearchRunStatus> = new Set([
  "completed",
  "failed",
  "cancelled",
]);

const ACTIVE_STATUSES: DeepResearchRunStatus[] = ["running", "awaiting_clarify"];

const NEVER_DROP_TYPES = new Set<DeepResearchEvent["type"]>([
  "run_started",
  "clarify",
  "clarify_chat",
  "research_profile",
  "research_plan",
]);

export type ClarifyResumePayload = {
  answers: Record<string, string>;
  skip: boolean;
  timedOut?: boolean;
};

/** Written by `expireClarification()` when nobody answered before the deadline. */
export function clarifyTimeoutPayload(): ClarifyResumePayload {
  return { answers: {}, skip: true, timedOut: true };
}

export type ClarificationOutcome = "resumed" | "already_continued" | "not_found";

export type RunRecord = {
  runId: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  traceId?: string;
  status: DeepResearchRunStatus;
  phase: string;
  topic: string;
  events: DeepResearchEvent[];
  /** Chat-visible delta buffer used when reconnecting; the canonical report lives in artifacts. */
  reportMarkdown: string;
  citations: Citation[];
  errorMessage?: string;
  eventSeq: number;
  /** Optimistic-lock counter bumped by every mutation. */
  revision: number;
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
    traceId?: string;
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
    status: DeepResearchTerminalStatus,
    errorMessage?: string,
  ): Promise<void>;
  /**
   * Atomically persist the clarify events, flip to `awaiting_clarify`, arm the
   * deadline and drop any stale answer. False when the run vanished or already
   * reached a terminal status — the caller must then not emit clarify SSE.
   */
  beginClarification(
    runId: string,
    events: DeepResearchEvent[],
    expiresAt: Date | null,
  ): Promise<boolean>;
  /** First valid answer wins; repeat submissions never overwrite it. */
  resolveClarification(input: {
    tenantId: string;
    userId: string;
    runId: string;
    payload: ClarifyResumePayload;
    now?: Date;
  }): Promise<ClarificationOutcome>;
  getClarificationResume(runId: string): Promise<ClarifyResumePayload | null>;
  /** Race the pending resume; returns whichever payload won. */
  expireClarification(runId: string, now?: Date): Promise<ClarifyResumePayload>;
  /** Re-open a non-completed orphaned plan gate after its original waiter died. */
  reopenForContinue(
    runId: string,
    patch?: { status?: DeepResearchRunStatus; phase?: string },
  ): Promise<boolean>;
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
    status: DeepResearchTerminalStatus,
    errorMessage?: string,
  ): Promise<void>;
};

export const STALE_RUN_ERROR_MESSAGE = "stale run reaped after process restart";

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

/** Coerce a persisted clarify answer blob back into a trusted payload shape. */
export function normalizeClarifyResume(value: unknown): ClarifyResumePayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as { answers?: unknown; skip?: unknown; timedOut?: unknown };
  const answers: Record<string, string> = {};
  if (raw.answers && typeof raw.answers === "object" && !Array.isArray(raw.answers)) {
    for (const [key, entry] of Object.entries(raw.answers as Record<string, unknown>)) {
      if (typeof entry === "string") answers[key] = entry;
    }
  }
  const payload: ClarifyResumePayload = { answers, skip: raw.skip === true };
  if (raw.timedOut === true) payload.timedOut = true;
  return payload;
}

function mapRow(row: {
  runId: string;
  tenantId: string;
  userId: string;
  sessionId: string;
  traceId?: string | null;
  status: string;
  phase: string;
  topic: string;
  events: unknown;
  reportMarkdown: string;
  citations: unknown;
  errorMessage: string | null;
  eventSeq: number;
  revision: number;
  createdAt: Date | string;
  updatedAt: Date | string;
}): RunRecord {
  return {
    runId: row.runId,
    tenantId: row.tenantId,
    userId: row.userId,
    sessionId: row.sessionId,
    traceId: row.traceId ?? undefined,
    status: isRunStatus(row.status) ? row.status : "running",
    phase: row.phase,
    topic: row.topic,
    events: asEvents(row.events),
    reportMarkdown: row.reportMarkdown ?? "",
    citations: asCitations(row.citations),
    errorMessage: row.errorMessage ?? undefined,
    eventSeq: Number(row.eventSeq) || 0,
    revision: Number(row.revision) || 0,
    createdAt: toIso(row.createdAt),
    updatedAt: toIso(row.updatedAt),
  };
}

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
  return false;
}

/**
 * Trim events when over MAX_EVENTS_PER_RUN.
 * Prefer dropping transient reasoning, then lane_progress, narrative, and lane_sources;
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
    if (dropOldestOfType("reasoning")) continue;
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

/** Keep one full-text reasoning snapshot per stage while preserving event order. */
export function mergeRunEvents(
  current: DeepResearchEvent[],
  incoming: DeepResearchEvent[],
): DeepResearchEvent[] {
  const next = [...current];
  for (const event of incoming) {
    if (event.type === "reasoning") {
      const existing = next.findIndex(
        (candidate) => candidate.type === "reasoning" && candidate.id === event.id,
      );
      if (existing >= 0) {
        next[existing] = event;
        continue;
      }
    }
    next.push(event);
  }
  return trimEvents(next);
}

type MemoryRow = RunRecord & {
  clarifyResume: ClarifyResumePayload | null;
  clarifyExpiresAt: Date | null;
};

function snapshot(row: MemoryRow): RunRecord {
  const {
    clarifyResume: _clarifyResume,
    clarifyExpiresAt: _clarifyExpiresAt,
    ...record
  } = row;
  return { ...record, events: [...row.events], citations: [...row.citations] };
}

function createMemoryStore(): RunStore {
  const bucket = new Map<string, MemoryRow>();

  return {
    async create(input) {
      const now = new Date().toISOString();
      const row: MemoryRow = {
        runId: input.runId,
        tenantId: input.tenantId,
        userId: input.userId,
        sessionId: input.sessionId,
        traceId: input.traceId,
        status: "running",
        phase: "recon",
        topic: input.topic,
        events: [],
        reportMarkdown: "",
        citations: [],
        eventSeq: 0,
        revision: 0,
        clarifyResume: null,
        clarifyExpiresAt: null,
        createdAt: now,
        updatedAt: now,
      };
      bucket.set(input.runId, row);
      return snapshot(row);
    },

    async appendEvents(runId, events, patch) {
      const row = bucket.get(runId);
      if (!row) return;
      if (TERMINAL_STATUSES.has(row.status)) return;
      if (events.length > 0) {
        row.events = mergeRunEvents(row.events, events);
        row.eventSeq += events.length;
      }
      if (patch?.status) row.status = patch.status;
      if (patch?.phase) row.phase = patch.phase;
      row.revision += 1;
      row.updatedAt = new Date().toISOString();
    },

    async appendReport(runId, chunk) {
      if (!chunk) return;
      const row = bucket.get(runId);
      if (!row) return;
      if (TERMINAL_STATUSES.has(row.status)) return;
      row.reportMarkdown = `${row.reportMarkdown}${chunk}`;
      row.revision += 1;
      row.updatedAt = new Date().toISOString();
    },

    async setCitations(runId, citations) {
      const row = bucket.get(runId);
      if (!row) return;
      row.citations = citations;
      row.revision += 1;
      row.updatedAt = new Date().toISOString();
    },

    async finish(runId, status, errorMessage) {
      const row = bucket.get(runId);
      if (!row) return;
      if (TERMINAL_STATUSES.has(row.status) && row.status !== status) return;
      if (TERMINAL_STATUSES.has(row.status) && errorMessage === undefined) return;
      row.status = status;
      if (errorMessage !== undefined) row.errorMessage = errorMessage;
      row.phase = "done";
      row.revision += 1;
      row.updatedAt = new Date().toISOString();
    },

    async beginClarification(runId, events, expiresAt) {
      const row = bucket.get(runId);
      if (!row) return false;
      if (TERMINAL_STATUSES.has(row.status)) return false;
      if (events.length > 0) {
        row.events = mergeRunEvents(row.events, events);
        row.eventSeq += events.length;
      }
      row.status = "awaiting_clarify";
      row.phase = "clarify";
      row.clarifyResume = null;
      row.clarifyExpiresAt = expiresAt;
      row.revision += 1;
      row.updatedAt = new Date().toISOString();
      return true;
    },

    async resolveClarification({ tenantId, userId, runId, payload, now }) {
      const row = bucket.get(runId);
      if (!row || row.tenantId !== tenantId || row.userId !== userId) return "not_found";
      const at = now ?? new Date();
      const expired =
        row.clarifyExpiresAt !== null && row.clarifyExpiresAt.getTime() <= at.getTime();
      if (row.status !== "awaiting_clarify" || row.clarifyResume !== null || expired) {
        return "already_continued";
      }
      row.clarifyResume = normalizeClarifyResume(payload) ?? { answers: {}, skip: true };
      row.status = "running";
      row.revision += 1;
      row.updatedAt = at.toISOString();
      return "resumed";
    },

    async getClarificationResume(runId) {
      const row = bucket.get(runId);
      return row?.clarifyResume ? { ...row.clarifyResume } : null;
    },

    async expireClarification(runId, now) {
      const row = bucket.get(runId);
      if (!row) return clarifyTimeoutPayload();
      if (row.status === "awaiting_clarify" && row.clarifyResume === null) {
        row.clarifyResume = clarifyTimeoutPayload();
        row.status = "running";
        row.revision += 1;
        row.updatedAt = (now ?? new Date()).toISOString();
      }
      return row.clarifyResume ? { ...row.clarifyResume } : clarifyTimeoutPayload();
    },

    async reopenForContinue(runId, patch) {
      const row = bucket.get(runId);
      if (!row || row.status === "completed") return false;
      row.status = patch?.status ?? "running";
      row.phase = patch?.phase ?? "lanes";
      row.errorMessage = undefined;
      row.clarifyResume = null;
      row.clarifyExpiresAt = null;
      row.revision += 1;
      row.updatedAt = new Date().toISOString();
      return true;
    },

    async get(tenantId, userId, runId) {
      const row = bucket.get(runId);
      if (!row) return null;
      if (row.tenantId !== tenantId || row.userId !== userId) return null;
      return snapshot(row);
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
        .map(snapshot);
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
      return row ? snapshot(row) : null;
    },

    async reapStaleRuns(olderThanMs) {
      const cutoff = Date.now() - olderThanMs;
      let count = 0;
      for (const row of bucket.values()) {
        if (!ACTIVE_STATUSES.includes(row.status)) continue;
        if (Date.parse(row.updatedAt) >= cutoff) continue;
        row.status = "failed";
        row.errorMessage = STALE_RUN_ERROR_MESSAGE;
        row.phase = "done";
        row.revision += 1;
        row.updatedAt = new Date().toISOString();
        count += 1;
      }
      return count;
    },
  };
}

/** Snapshot needed to compute the next CAS write. */
export type RunAppendState = {
  status: DeepResearchRunStatus;
  events: DeepResearchEvent[];
  eventSeq: number;
  revision: number;
};

/**
 * Dialect primitives behind the SQL store. Each mutation returns the number of
 * rows it actually changed so the caller can distinguish "lost the race" from
 * "row is gone / already terminal" without a second read.
 */
export type RunSqlOps = {
  create(record: {
    runId: string;
    tenantId: string;
    userId: string;
    sessionId: string;
    topic: string;
    traceId?: string;
    now: Date;
  }): Promise<void>;
  loadAppendState(runId: string): Promise<RunAppendState | null>;
  casAppendEvents(input: {
    runId: string;
    revision: number;
    events: DeepResearchEvent[];
    eventSeq: number;
    status?: DeepResearchRunStatus;
    phase?: string;
    now: Date;
  }): Promise<number>;
  casBeginClarification(input: {
    runId: string;
    revision: number;
    events: DeepResearchEvent[];
    eventSeq: number;
    expiresAt: Date | null;
    now: Date;
  }): Promise<number>;
  appendReportChunk(runId: string, chunk: string, now: Date): Promise<number>;
  setCitations(runId: string, citations: Citation[], now: Date): Promise<number>;
  finishRun(input: {
    runId: string;
    status: DeepResearchTerminalStatus;
    errorMessage?: string;
    now: Date;
  }): Promise<number>;
  reopenForContinue(input: {
    runId: string;
    status: DeepResearchRunStatus;
    phase: string;
    now: Date;
  }): Promise<number>;
  reapStale(cutoff: Date, now: Date): Promise<number>;
  resolveClarification(input: {
    runId: string;
    tenantId: string;
    userId: string;
    payload: ClarifyResumePayload;
    now: Date;
  }): Promise<number>;
  expireClarification(input: {
    runId: string;
    payload: ClarifyResumePayload;
    now: Date;
  }): Promise<number>;
  readClarifyResume(runId: string): Promise<unknown>;
  get(tenantId: string, userId: string, runId: string): Promise<RunRecord | null>;
  listActive(tenantId: string, userId: string, sessionId?: string): Promise<RunRecord[]>;
  getLatestBySession(
    tenantId: string,
    userId: string,
    sessionId: string,
  ): Promise<RunRecord | null>;
};

type PgDb = ReturnType<typeof getIamDb>;
type MysqlDb = Awaited<ReturnType<typeof createMysqlDb>>["raw"];

function createPgOps(db: PgDb): RunSqlOps {
  return {
    async create({ runId, tenantId, userId, sessionId, topic, traceId, now }) {
      await db.insert(pgTable).values({
        runId,
        tenantId,
        userId,
        sessionId,
        traceId: traceId ?? null,
        status: "running",
        phase: "recon",
        topic,
        events: [],
        reportMarkdown: "",
        citations: [],
        errorMessage: null,
        eventSeq: 0,
        revision: 0,
        clarifyResume: null,
        clarifyExpiresAt: null,
        createdAt: now,
        updatedAt: now,
      });
    },

    async loadAppendState(runId) {
      const rows = await db
        .select({
          status: pgTable.status,
          events: pgTable.events,
          eventSeq: pgTable.eventSeq,
          revision: pgTable.revision,
        })
        .from(pgTable)
        .where(eq(pgTable.runId, runId))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        status: isRunStatus(row.status) ? row.status : "running",
        events: asEvents(row.events),
        eventSeq: Number(row.eventSeq) || 0,
        revision: Number(row.revision) || 0,
      };
    },

    async casAppendEvents({ runId, revision, events, eventSeq, status, phase, now }) {
      const rows = await db
        .update(pgTable)
        .set({
          events: events as unknown[],
          eventSeq,
          revision: revision + 1,
          ...(status ? { status } : {}),
          ...(phase ? { phase } : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(pgTable.runId, runId),
            eq(pgTable.revision, revision),
            inArray(pgTable.status, ACTIVE_STATUSES),
          ),
        )
        .returning({ runId: pgTable.runId });
      return rows.length;
    },

    async casBeginClarification({ runId, revision, events, eventSeq, expiresAt, now }) {
      const rows = await db
        .update(pgTable)
        .set({
          events: events as unknown[],
          eventSeq,
          revision: revision + 1,
          status: "awaiting_clarify",
          phase: "clarify",
          clarifyResume: null,
          clarifyExpiresAt: expiresAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(pgTable.runId, runId),
            eq(pgTable.revision, revision),
            inArray(pgTable.status, ACTIVE_STATUSES),
          ),
        )
        .returning({ runId: pgTable.runId });
      return rows.length;
    },

    async appendReportChunk(runId, chunk, now) {
      const rows = await db
        .update(pgTable)
        .set({
          reportMarkdown: sql`${pgTable.reportMarkdown} || ${chunk}`,
          revision: sql`${pgTable.revision} + 1`,
          updatedAt: now,
        })
        .where(and(eq(pgTable.runId, runId), inArray(pgTable.status, ACTIVE_STATUSES)))
        .returning({ runId: pgTable.runId });
      return rows.length;
    },

    async setCitations(runId, citations, now) {
      const rows = await db
        .update(pgTable)
        .set({
          citations: citations as unknown[],
          revision: sql`${pgTable.revision} + 1`,
          updatedAt: now,
        })
        .where(eq(pgTable.runId, runId))
        .returning({ runId: pgTable.runId });
      return rows.length;
    },

    async finishRun({ runId, status, errorMessage, now }) {
      const rows = await db
        .update(pgTable)
        .set({
          status,
          phase: "done",
          revision: sql`${pgTable.revision} + 1`,
          updatedAt: now,
          ...(errorMessage !== undefined ? { errorMessage } : {}),
        })
        .where(and(eq(pgTable.runId, runId), finishGuardPg(status, errorMessage)))
        .returning({ runId: pgTable.runId });
      return rows.length;
    },

    async reopenForContinue({ runId, status, phase, now }) {
      const rows = await db
        .update(pgTable)
        .set({
          status,
          phase,
          errorMessage: null,
          clarifyResume: null,
          clarifyExpiresAt: null,
          revision: sql`${pgTable.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(pgTable.runId, runId),
            inArray(pgTable.status, ["running", "awaiting_clarify", "failed", "cancelled"]),
          ),
        )
        .returning({ runId: pgTable.runId });
      return rows.length;
    },

    async reapStale(cutoff, now) {
      const rows = await db
        .update(pgTable)
        .set({
          status: "failed",
          phase: "done",
          errorMessage: STALE_RUN_ERROR_MESSAGE,
          revision: sql`${pgTable.revision} + 1`,
          updatedAt: now,
        })
        .where(and(inArray(pgTable.status, ACTIVE_STATUSES), lt(pgTable.updatedAt, cutoff)))
        .returning({ runId: pgTable.runId });
      return rows.length;
    },

    async resolveClarification({ runId, tenantId, userId, payload, now }) {
      const rows = await db
        .update(pgTable)
        .set({
          clarifyResume: payload,
          status: "running",
          revision: sql`${pgTable.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(pgTable.runId, runId),
            eq(pgTable.tenantId, tenantId),
            eq(pgTable.userId, userId),
            eq(pgTable.status, "awaiting_clarify"),
            isNull(pgTable.clarifyResume),
            or(isNull(pgTable.clarifyExpiresAt), gt(pgTable.clarifyExpiresAt, now)),
          ),
        )
        .returning({ runId: pgTable.runId });
      return rows.length;
    },

    async expireClarification({ runId, payload, now }) {
      const rows = await db
        .update(pgTable)
        .set({
          clarifyResume: payload,
          status: "running",
          revision: sql`${pgTable.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(pgTable.runId, runId),
            eq(pgTable.status, "awaiting_clarify"),
            isNull(pgTable.clarifyResume),
          ),
        )
        .returning({ runId: pgTable.runId });
      return rows.length;
    },

    async readClarifyResume(runId) {
      const rows = await db
        .select({ clarifyResume: pgTable.clarifyResume })
        .from(pgTable)
        .where(eq(pgTable.runId, runId))
        .limit(1);
      return rows[0]?.clarifyResume ?? null;
    },

    async get(tenantId, userId, runId) {
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
  };
}

/**
 * First terminal status wins. A later call carrying `errorMessage` may still
 * enrich the *same* terminal status (persistFinish saves citations first, then
 * the message), but completed/failed/cancelled never overwrite each other.
 */
function finishGuardPg(status: DeepResearchTerminalStatus, errorMessage?: string) {
  const active = inArray(pgTable.status, ACTIVE_STATUSES);
  if (errorMessage === undefined) return active;
  return or(active, eq(pgTable.status, status));
}

function finishGuardMysql(status: DeepResearchTerminalStatus, errorMessage?: string) {
  const active = inArray(mysqlTable.status, ACTIVE_STATUSES);
  if (errorMessage === undefined) return active;
  return or(active, eq(mysqlTable.status, status));
}

/** mysql2 returns `[ResultSetHeader, FieldPacket[]]`; PG counts `returning()` rows instead. */
export function mysqlAffectedRows(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  const rows = (header as { affectedRows?: unknown } | undefined)?.affectedRows;
  return typeof rows === "number" ? rows : 0;
}

function createMysqlOps(db: MysqlDb): RunSqlOps {
  return {
    async create({ runId, tenantId, userId, sessionId, topic, traceId, now }) {
      await db.insert(mysqlTable).values({
        runId,
        tenantId,
        userId,
        sessionId,
        traceId: traceId ?? null,
        status: "running",
        phase: "recon",
        topic,
        events: [],
        reportMarkdown: "",
        citations: [],
        errorMessage: null,
        eventSeq: 0,
        revision: 0,
        clarifyResume: null,
        clarifyExpiresAt: null,
        createdAt: now,
        updatedAt: now,
      });
    },

    async loadAppendState(runId) {
      const rows = await db
        .select({
          status: mysqlTable.status,
          events: mysqlTable.events,
          eventSeq: mysqlTable.eventSeq,
          revision: mysqlTable.revision,
        })
        .from(mysqlTable)
        .where(eq(mysqlTable.runId, runId))
        .limit(1);
      const row = rows[0];
      if (!row) return null;
      return {
        status: isRunStatus(row.status) ? row.status : "running",
        events: asEvents(row.events),
        eventSeq: Number(row.eventSeq) || 0,
        revision: Number(row.revision) || 0,
      };
    },

    async casAppendEvents({ runId, revision, events, eventSeq, status, phase, now }) {
      const result = await db
        .update(mysqlTable)
        .set({
          events: events as unknown[],
          eventSeq,
          revision: revision + 1,
          ...(status ? { status } : {}),
          ...(phase ? { phase } : {}),
          updatedAt: now,
        })
        .where(
          and(
            eq(mysqlTable.runId, runId),
            eq(mysqlTable.revision, revision),
            inArray(mysqlTable.status, ACTIVE_STATUSES),
          ),
        );
      return mysqlAffectedRows(result);
    },

    async casBeginClarification({ runId, revision, events, eventSeq, expiresAt, now }) {
      const result = await db
        .update(mysqlTable)
        .set({
          events: events as unknown[],
          eventSeq,
          revision: revision + 1,
          status: "awaiting_clarify",
          phase: "clarify",
          clarifyResume: null,
          clarifyExpiresAt: expiresAt,
          updatedAt: now,
        })
        .where(
          and(
            eq(mysqlTable.runId, runId),
            eq(mysqlTable.revision, revision),
            inArray(mysqlTable.status, ACTIVE_STATUSES),
          ),
        );
      return mysqlAffectedRows(result);
    },

    async appendReportChunk(runId, chunk, now) {
      const result = await db
        .update(mysqlTable)
        .set({
          reportMarkdown: sql`concat(${mysqlTable.reportMarkdown}, ${chunk})`,
          revision: sql`${mysqlTable.revision} + 1`,
          updatedAt: now,
        })
        .where(and(eq(mysqlTable.runId, runId), inArray(mysqlTable.status, ACTIVE_STATUSES)));
      return mysqlAffectedRows(result);
    },

    async setCitations(runId, citations, now) {
      const result = await db
        .update(mysqlTable)
        .set({
          citations: citations as unknown[],
          revision: sql`${mysqlTable.revision} + 1`,
          updatedAt: now,
        })
        .where(eq(mysqlTable.runId, runId));
      return mysqlAffectedRows(result);
    },

    async finishRun({ runId, status, errorMessage, now }) {
      const result = await db
        .update(mysqlTable)
        .set({
          status,
          phase: "done",
          revision: sql`${mysqlTable.revision} + 1`,
          updatedAt: now,
          ...(errorMessage !== undefined ? { errorMessage } : {}),
        })
        .where(and(eq(mysqlTable.runId, runId), finishGuardMysql(status, errorMessage)));
      return mysqlAffectedRows(result);
    },

    async reopenForContinue({ runId, status, phase, now }) {
      const result = await db
        .update(mysqlTable)
        .set({
          status,
          phase,
          errorMessage: null,
          clarifyResume: null,
          clarifyExpiresAt: null,
          revision: sql`${mysqlTable.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(mysqlTable.runId, runId),
            inArray(mysqlTable.status, ["running", "awaiting_clarify", "failed", "cancelled"]),
          ),
        );
      return mysqlAffectedRows(result);
    },

    async reapStale(cutoff, now) {
      const result = await db
        .update(mysqlTable)
        .set({
          status: "failed",
          phase: "done",
          errorMessage: STALE_RUN_ERROR_MESSAGE,
          revision: sql`${mysqlTable.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(inArray(mysqlTable.status, ACTIVE_STATUSES), lt(mysqlTable.updatedAt, cutoff)),
        );
      return mysqlAffectedRows(result);
    },

    async resolveClarification({ runId, tenantId, userId, payload, now }) {
      const result = await db
        .update(mysqlTable)
        .set({
          clarifyResume: payload,
          status: "running",
          revision: sql`${mysqlTable.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(mysqlTable.runId, runId),
            eq(mysqlTable.tenantId, tenantId),
            eq(mysqlTable.userId, userId),
            eq(mysqlTable.status, "awaiting_clarify"),
            isNull(mysqlTable.clarifyResume),
            or(isNull(mysqlTable.clarifyExpiresAt), gt(mysqlTable.clarifyExpiresAt, now)),
          ),
        );
      return mysqlAffectedRows(result);
    },

    async expireClarification({ runId, payload, now }) {
      const result = await db
        .update(mysqlTable)
        .set({
          clarifyResume: payload,
          status: "running",
          revision: sql`${mysqlTable.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(mysqlTable.runId, runId),
            eq(mysqlTable.status, "awaiting_clarify"),
            isNull(mysqlTable.clarifyResume),
          ),
        );
      return mysqlAffectedRows(result);
    },

    async readClarifyResume(runId) {
      const rows = await db
        .select({ clarifyResume: mysqlTable.clarifyResume })
        .from(mysqlTable)
        .where(eq(mysqlTable.runId, runId))
        .limit(1);
      return rows[0]?.clarifyResume ?? null;
    },

    async get(tenantId, userId, runId) {
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
    },

    async listActive(tenantId, userId, sessionId) {
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
      return rows.map(mapRow).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },

    async getLatestBySession(tenantId, userId, sessionId) {
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
    },
  };
}

async function resolveDialectOps(): Promise<RunSqlOps> {
  const config = resolveDatabaseConfig();
  if (config.dialect === "mysql") {
    const { raw } = await createMysqlDb(config);
    return createMysqlOps(raw);
  }
  return createPgOps(getIamDb());
}

export class RunCasExhaustedError extends Error {
  constructor(runId: string, operation: string) {
    super(`deep-research run ${runId}: ${operation} lost ${MAX_RUN_CAS_ATTEMPTS} CAS attempts`);
    this.name = "RunCasExhaustedError";
  }
}

/** Exported for tests: the dialect seam can be replaced with a fake driver. */
export function createSqlRunStore(loadOps: () => Promise<RunSqlOps> = resolveDialectOps): RunStore {
  /**
   * Read → merge → conditional UPDATE. A lost race means another instance
   * already bumped `revision`, so we re-read and rebuild the merge instead of
   * clobbering their events.
   */
  const casMerge = async (
    runId: string,
    events: DeepResearchEvent[],
    apply: (
      ops: RunSqlOps,
      state: RunAppendState,
      merged: DeepResearchEvent[],
      eventSeq: number,
    ) => Promise<number>,
    operation: string,
  ): Promise<"applied" | "unavailable"> => {
    const ops = await loadOps();
    for (let attempt = 0; attempt < MAX_RUN_CAS_ATTEMPTS; attempt += 1) {
      const state = await ops.loadAppendState(runId);
      if (!state) return "unavailable";
      if (TERMINAL_STATUSES.has(state.status)) return "unavailable";
      const merged =
        events.length > 0 ? mergeRunEvents(state.events, events) : state.events;
      const changed = await apply(ops, state, merged, state.eventSeq + events.length);
      if (changed > 0) return "applied";
    }
    throw new RunCasExhaustedError(runId, operation);
  };

  return {
    async create(input) {
      const now = new Date();
      const ops = await loadOps();
      await ops.create({ ...input, now });
      return {
        runId: input.runId,
        tenantId: input.tenantId,
        userId: input.userId,
        sessionId: input.sessionId,
        traceId: input.traceId,
        status: "running",
        phase: "recon",
        topic: input.topic,
        events: [],
        reportMarkdown: "",
        citations: [],
        eventSeq: 0,
        revision: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
    },

    async appendEvents(runId, events, patch) {
      await casMerge(
        runId,
        events,
        (ops, state, merged, eventSeq) =>
          ops.casAppendEvents({
            runId,
            revision: state.revision,
            events: merged,
            eventSeq,
            status: patch?.status,
            phase: patch?.phase,
            now: new Date(),
          }),
        "appendEvents",
      );
    },

    async appendReport(runId, chunk) {
      if (!chunk) return;
      const ops = await loadOps();
      await ops.appendReportChunk(runId, chunk, new Date());
    },

    async setCitations(runId, citations) {
      const ops = await loadOps();
      await ops.setCitations(runId, citations, new Date());
    },

    async finish(runId, status, errorMessage) {
      const ops = await loadOps();
      await ops.finishRun({ runId, status, errorMessage, now: new Date() });
    },

    async beginClarification(runId, events, expiresAt) {
      const outcome = await casMerge(
        runId,
        events,
        (ops, state, merged, eventSeq) =>
          ops.casBeginClarification({
            runId,
            revision: state.revision,
            events: merged,
            eventSeq,
            expiresAt,
            now: new Date(),
          }),
        "beginClarification",
      );
      return outcome === "applied";
    },

    async resolveClarification({ tenantId, userId, runId, payload, now }) {
      const ops = await loadOps();
      const at = now ?? new Date();
      const changed = await ops.resolveClarification({
        runId,
        tenantId,
        userId,
        payload: normalizeClarifyResume(payload) ?? { answers: {}, skip: true },
        now: at,
      });
      if (changed > 0) return "resumed";
      // Ownership is checked in the same statement, so a miss is either a
      // foreign/absent run (404) or a run that already moved on (idempotent 200).
      const existing = await ops.get(tenantId, userId, runId);
      return existing ? "already_continued" : "not_found";
    },

    async getClarificationResume(runId) {
      const ops = await loadOps();
      return normalizeClarifyResume(await ops.readClarifyResume(runId));
    },

    async expireClarification(runId, now) {
      const ops = await loadOps();
      const at = now ?? new Date();
      await ops.expireClarification({ runId, payload: clarifyTimeoutPayload(), now: at });
      // Re-read: a concurrent resume may have won the race.
      return normalizeClarifyResume(await ops.readClarifyResume(runId)) ?? clarifyTimeoutPayload();
    },

    async reopenForContinue(runId, patch) {
      const ops = await loadOps();
      const changed = await ops.reopenForContinue({
        runId,
        status: patch?.status ?? "running",
        phase: patch?.phase ?? "lanes",
        now: new Date(),
      });
      return changed > 0;
    },

    async get(tenantId, userId, runId) {
      const ops = await loadOps();
      return ops.get(tenantId, userId, runId);
    },

    async listActive(tenantId, userId, sessionId) {
      const ops = await loadOps();
      return ops.listActive(tenantId, userId, sessionId);
    },

    async getLatestBySession(tenantId, userId, sessionId) {
      const ops = await loadOps();
      return ops.getLatestBySession(tenantId, userId, sessionId);
    },

    async reapStaleRuns(olderThanMs) {
      const ops = await loadOps();
      const now = new Date();
      return ops.reapStale(new Date(now.getTime() - olderThanMs), now);
    },
  };
}

/** Events appended since lastEventSeq (tail slice; safe when oldest noise was trimmed). */
export function newEventsSince(record: RunRecord, lastEventSeq: number): DeepResearchEvent[] {
  const delta = record.eventSeq - lastEventSeq;
  if (delta <= 0) return [];
  return record.events.slice(-Math.min(delta, record.events.length));
}

/** Refresh hydrate depends on these state transitions; do not leave them in the batch window. */
const IMMEDIATE_FLUSH_EVENT_TYPES = new Set<DeepResearchEvent["type"]>([
  "run_started",
  "phase",
  "clarify",
  "clarify_chat",
  "research_profile",
  "research_plan",
  "lane_started",
  "lane_done",
  "artifact",
  "reflection",
]);

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

    flushChain = flushChain
      .then(async () => {
        // Report chunks first: a terminal status patch in the same flush must not
        // block appendReport (finish / phase=done often lands with the last summary).
        if (report) {
          await store.appendReport(runId, report);
        }
        if (events.length > 0 || patch) {
          await store.appendEvents(runId, events, patch);
        }
      })
      // A poisoned chain would silently stall every later flush; log and continue.
      .catch((error) => {
        console.warn("[deep-research] run-store flush failed:", error);
      });
    await flushChain;
  };

  return {
    push(event, patch) {
      const stamped: DeepResearchEvent = {
        ...event,
        ts: event.ts ?? new Date().toISOString(),
      };
      if (stamped.type === "reasoning") {
        // Reasoning snapshots carry the full bounded text. Keep only the latest
        // snapshot per stage inside each flush window instead of persisting every token.
        const existing = pendingEvents.findIndex(
          (candidate) => candidate.type === "reasoning" && candidate.id === stamped.id,
        );
        if (existing >= 0) pendingEvents[existing] = stamped;
        else pendingEvents.push(stamped);
      } else {
        pendingEvents.push(stamped);
      }
      const nextPatch = { ...pendingPatch };
      if (patch?.status) nextPatch.status = patch.status;
      if (patch?.phase) nextPatch.phase = patch.phase;
      if (stamped.type === "phase" && typeof stamped.phase === "string") {
        nextPatch.phase = stamped.phase;
      }
      if (Object.keys(nextPatch).length > 0) pendingPatch = nextPatch;
      if (IMMEDIATE_FLUSH_EVENT_TYPES.has(stamped.type)) {
        void flush();
      } else {
        schedule();
      }
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
    return createSqlRunStore();
  } catch {
    return createMemoryStore();
  }
}

export const defaultRunStore = createRunStore();

/** Test helper — isolated in-memory bucket (safe for parallel tests). */
export function createMemoryRunStore(): RunStore {
  return createMemoryStore();
}
