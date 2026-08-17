/**
 * SQL-store concurrency contract.
 *
 * The dialect seam (`RunSqlOps`) is replaced with a driver that enforces exactly
 * the predicates the PostgreSQL / MySQL statements enforce, so the CAS retry,
 * terminal-status and affected-rows branches are exercised without a database.
 * The same scenarios must also run against real PostgreSQL and MySQL in CI.
 */

import { describe, expect, it, vi } from "vitest";
import type { DeepResearchEvent } from "@agenticx/sdk-ts";
import {
  MAX_RUN_CAS_ATTEMPTS,
  RunCasExhaustedError,
  STALE_RUN_ERROR_MESSAGE,
  createSqlRunStore,
  mergeRunEvents,
  mysqlAffectedRows,
  normalizeClarifyResume,
  type ClarifyResumePayload,
  type DeepResearchRunStatus,
  type RunSqlOps,
} from "./run-store";
import type { Citation } from "./registry";

type FakeRow = {
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
  errorMessage: string | null;
  eventSeq: number;
  revision: number;
  clarifyResume: unknown;
  clarifyExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const ACTIVE = new Set<DeepResearchRunStatus>(["running", "awaiting_clarify"]);
const TERMINAL = new Set<DeepResearchRunStatus>(["completed", "failed", "cancelled"]);

type Driver = {
  ops: RunSqlOps;
  rows: Map<string, FakeRow>;
  /** Runs just before each conditional UPDATE — models another instance winning. */
  hooks: { beforeWrite: ((row: FakeRow) => void) | null };
  loads: number;
};

function createDriver(): Driver {
  const rows = new Map<string, FakeRow>();
  const hooks: Driver["hooks"] = { beforeWrite: null };
  const driver = { rows, hooks, loads: 0 } as Driver;

  /** Mirrors "UPDATE ... WHERE <guard>" — returns rows actually changed. */
  const update = (runId: string, guard: (row: FakeRow) => boolean, apply: (row: FakeRow) => void) => {
    const row = rows.get(runId);
    if (!row) return 0;
    hooks.beforeWrite?.(row);
    if (!guard(row)) return 0;
    apply(row);
    return 1;
  };

  driver.ops = {
    async create({ runId, tenantId, userId, sessionId, topic, now }) {
      rows.set(runId, {
        runId,
        tenantId,
        userId,
        sessionId,
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
      driver.loads += 1;
      const row = rows.get(runId);
      if (!row) return null;
      return {
        status: row.status,
        events: [...row.events],
        eventSeq: row.eventSeq,
        revision: row.revision,
      };
    },

    async casAppendEvents({ runId, revision, events, eventSeq, status, phase, now }) {
      return update(
        runId,
        (row) => row.revision === revision && ACTIVE.has(row.status),
        (row) => {
          row.events = events;
          row.eventSeq = eventSeq;
          row.revision = revision + 1;
          if (status) row.status = status;
          if (phase) row.phase = phase;
          row.updatedAt = now;
        },
      );
    },

    async casBeginClarification({ runId, revision, events, eventSeq, expiresAt, phase, now }) {
      return update(
        runId,
        (row) => row.revision === revision && ACTIVE.has(row.status),
        (row) => {
          row.events = events;
          row.eventSeq = eventSeq;
          row.revision = revision + 1;
          row.status = "awaiting_clarify";
          row.phase = phase;
          row.clarifyResume = null;
          row.clarifyExpiresAt = expiresAt;
          row.updatedAt = now;
        },
      );
    },

    async appendReportChunk(runId, chunk, now) {
      return update(
        runId,
        (row) => ACTIVE.has(row.status),
        (row) => {
          // SQL-side concat: no read-modify-write in the store.
          row.reportMarkdown = `${row.reportMarkdown}${chunk}`;
          row.revision += 1;
          row.updatedAt = now;
        },
      );
    },

    async setCitations(runId, citations, now) {
      return update(
        runId,
        () => true,
        (row) => {
          row.citations = citations;
          row.revision += 1;
          row.updatedAt = now;
        },
      );
    },

    async finishRun({ runId, status, errorMessage, now }) {
      return update(
        runId,
        (row) =>
          ACTIVE.has(row.status) || (errorMessage !== undefined && row.status === status),
        (row) => {
          row.status = status;
          row.phase = "done";
          if (errorMessage !== undefined) row.errorMessage = errorMessage;
          row.revision += 1;
          row.updatedAt = now;
        },
      );
    },

    async claimPlanGateResume({ runId, now }) {
      return update(
        runId,
        (row) =>
          row.status === "running" &&
          row.phase === "plan" &&
          row.clarifyResume !== null,
        (row) => {
          row.phase = "plan_resuming";
          row.revision += 1;
          row.updatedAt = now;
        },
      );
    },

    async reopenForContinue({ runId, status, phase, now }) {
      return update(
        runId,
        (row) => row.status !== "completed",
        (row) => {
          row.status = status;
          row.phase = phase;
          row.errorMessage = null;
          row.clarifyResume = null;
          row.clarifyExpiresAt = null;
          row.revision += 1;
          row.updatedAt = now;
        },
      );
    },

    async reapStale(cutoff, now) {
      let changed = 0;
      for (const row of rows.values()) {
        if (!ACTIVE.has(row.status)) continue;
        if (row.updatedAt.getTime() >= cutoff.getTime()) continue;
        row.status = "failed";
        row.phase = "done";
        row.errorMessage = STALE_RUN_ERROR_MESSAGE;
        row.revision += 1;
        row.updatedAt = now;
        changed += 1;
      }
      return changed;
    },

    async resolveClarification({ runId, tenantId, userId, payload, now }) {
      return update(
        runId,
        (row) =>
          row.tenantId === tenantId &&
          row.userId === userId &&
          row.status === "awaiting_clarify" &&
          row.clarifyResume === null &&
          (row.clarifyExpiresAt === null || row.clarifyExpiresAt.getTime() > now.getTime()),
        (row) => {
          row.clarifyResume = payload;
          row.status = "running";
          row.revision += 1;
          row.updatedAt = now;
        },
      );
    },

    async expireClarification({ runId, payload, now }) {
      return update(
        runId,
        (row) => row.status === "awaiting_clarify" && row.clarifyResume === null,
        (row) => {
          row.clarifyResume = payload;
          row.status = "running";
          row.revision += 1;
          row.updatedAt = now;
        },
      );
    },

    async readClarifyResume(runId) {
      return rows.get(runId)?.clarifyResume ?? null;
    },

    async get(tenantId, userId, runId) {
      const row = rows.get(runId);
      if (!row || row.tenantId !== tenantId || row.userId !== userId) return null;
      return toRecord(row);
    },

    async listActive(tenantId, userId, sessionId) {
      return [...rows.values()]
        .filter(
          (row) =>
            row.tenantId === tenantId &&
            row.userId === userId &&
            ACTIVE.has(row.status) &&
            (sessionId === undefined || row.sessionId === sessionId),
        )
        .map(toRecord);
    },

    async getLatestBySession(tenantId, userId, sessionId) {
      const matches = [...rows.values()]
        .filter(
          (row) =>
            row.tenantId === tenantId && row.userId === userId && row.sessionId === sessionId,
        )
        .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());
      return matches[0] ? toRecord(matches[0]) : null;
    },
  };

  return driver;
}

function toRecord(row: FakeRow) {
  return {
    runId: row.runId,
    tenantId: row.tenantId,
    userId: row.userId,
    sessionId: row.sessionId,
    status: row.status,
    phase: row.phase,
    topic: row.topic,
    events: [...row.events],
    reportMarkdown: row.reportMarkdown,
    citations: [...row.citations],
    errorMessage: row.errorMessage ?? undefined,
    eventSeq: row.eventSeq,
    revision: row.revision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

const OWNER = { tenantId: "t1", userId: "u1" };

async function seeded() {
  const driver = createDriver();
  const store = createSqlRunStore(async () => driver.ops);
  await store.create({ ...OWNER, runId: "r1", sessionId: "s1", topic: "主题" });
  return { driver, store };
}

function narrative(text: string): DeepResearchEvent {
  return { type: "narrative", text };
}

describe("sql run store — event append CAS", () => {
  it("keeps both writers' events when a concurrent append lands mid-CAS", async () => {
    const { driver, store } = await seeded();
    let injected = false;
    driver.hooks.beforeWrite = (row) => {
      if (injected) return;
      injected = true;
      // Instance B commits between instance A's SELECT and UPDATE.
      row.events = mergeRunEvents(row.events, [narrative("B")]);
      row.eventSeq += 1;
      row.revision += 1;
    };

    await store.appendEvents("r1", [narrative("A")]);

    const row = driver.rows.get("r1")!;
    expect(row.events.map((event) => (event as { text: string }).text)).toEqual(["B", "A"]);
    expect(row.eventSeq).toBe(2);
    expect(row.revision).toBe(2);
  });

  it("re-reads before every retry so a lost race never clobbers state", async () => {
    const { driver, store } = await seeded();
    let remaining = 3;
    driver.hooks.beforeWrite = (row) => {
      if (remaining <= 0) return;
      remaining -= 1;
      row.revision += 1;
    };

    await store.appendEvents("r1", [narrative("A")]);
    expect(driver.loads).toBe(4);
    expect(driver.rows.get("r1")!.events).toHaveLength(1);
  });

  it("throws instead of silently dropping events after the retry budget", async () => {
    const { driver, store } = await seeded();
    driver.hooks.beforeWrite = (row) => {
      row.revision += 1;
    };

    await expect(store.appendEvents("r1", [narrative("A")])).rejects.toBeInstanceOf(
      RunCasExhaustedError,
    );
    expect(driver.loads).toBe(MAX_RUN_CAS_ATTEMPTS);
    expect(driver.rows.get("r1")!.events).toHaveLength(0);
  });

  it("stops without retrying once the run reached a terminal status", async () => {
    const { driver, store } = await seeded();
    await store.finish("r1", "completed");
    driver.loads = 0;

    await store.appendEvents("r1", [narrative("late")]);
    expect(driver.loads).toBe(1);
    expect(driver.rows.get("r1")!.events).toHaveLength(0);
  });
});

describe("sql run store — report chunks", () => {
  it("concatenates concurrent chunks without a read-modify-write", async () => {
    const { driver, store } = await seeded();
    const loadsBefore = driver.loads;

    await Promise.all([
      store.appendReport("r1", "chunk-a"),
      store.appendReport("r1", "chunk-b"),
    ]);

    expect(driver.rows.get("r1")!.reportMarkdown).toBe("chunk-achunk-b");
    expect(driver.loads).toBe(loadsBefore);
  });

  it("refuses to append after the run finished", async () => {
    const { driver, store } = await seeded();
    await store.appendReport("r1", "body");
    await store.finish("r1", "completed");
    await store.appendReport("r1", "tail");
    expect(driver.rows.get("r1")!.reportMarkdown).toBe("body");
  });
});

describe("sql run store — terminal status", () => {
  it("lets the first terminal outcome win", async () => {
    const { driver, store } = await seeded();
    await Promise.all([
      store.finish("r1", "completed"),
      store.finish("r1", "cancelled"),
      store.finish("r1", "failed", "boom"),
    ]);
    expect(driver.rows.get("r1")!.status).toBe("completed");
    expect(driver.rows.get("r1")!.errorMessage).toBeNull();
  });

  it("still records the final error message for the winning status", async () => {
    const { driver, store } = await seeded();
    await store.appendEvents("r1", [], { status: "failed", phase: "done" });
    await store.finish("r1", "failed", "active-time deadline exceeded");
    expect(driver.rows.get("r1")!.status).toBe("failed");
    expect(driver.rows.get("r1")!.errorMessage).toBe("active-time deadline exceeded");
  });

  it("setCitations still lands after the run finished", async () => {
    const { driver, store } = await seeded();
    await store.finish("r1", "completed");
    await store.setCitations("r1", [{ index: 1, title: "t", url: "https://ex.com" } as Citation]);
    expect(driver.rows.get("r1")!.citations).toHaveLength(1);
  });
});

describe("sql run store — stale reaping", () => {
  it("reports the driver's affected-row count and spares fresh runs", async () => {
    const { driver, store } = await seeded();
    await store.create({ ...OWNER, runId: "r2", sessionId: "s1", topic: "旧" });
    driver.rows.get("r2")!.updatedAt = new Date(Date.now() - 7_200_000);

    expect(await store.reapStaleRuns(3_600_000)).toBe(1);
    expect(driver.rows.get("r1")!.status).toBe("running");
    expect(driver.rows.get("r2")!.status).toBe("failed");
    expect(driver.rows.get("r2")!.errorMessage).toBe(STALE_RUN_ERROR_MESSAGE);
  });
});

describe("sql run store — clarify coordination", () => {
  async function armed(ttlMs: number | null = 60_000) {
    const { driver, store } = await seeded();
    const ok = await store.beginClarification(
      "r1",
      [narrative("请确认方向")],
      ttlMs === null ? null : new Date(Date.now() + ttlMs),
    );
    return { driver, store, ok };
  }

  it("arms the row before any clarify SSE can be emitted", async () => {
    const { driver, ok } = await armed();
    expect(ok).toBe(true);
    expect(driver.rows.get("r1")!.status).toBe("awaiting_clarify");
    expect(driver.rows.get("r1")!.clarifyResume).toBeNull();
  });

  it("atomically persists the requested plan-gate phase", async () => {
    const { driver, store } = await seeded();
    await expect(
      store.beginClarification("r1", [narrative("确认计划")], null, "plan"),
    ).resolves.toBe(true);
    expect(driver.rows.get("r1")!.status).toBe("awaiting_clarify");
    expect(driver.rows.get("r1")!.phase).toBe("plan");
  });

  it("allows only one SQL-backed consumer to claim a resumed plan gate", async () => {
    const { driver, store } = await seeded();
    await store.beginClarification("r1", [narrative("确认计划")], null, "plan");
    await store.resolveClarification({
      ...OWNER,
      runId: "r1",
      payload: { answers: { __plan_action__: "approve" }, skip: false },
    });

    const claims = await Promise.all([
      store.claimPlanGateResume("r1"),
      store.claimPlanGateResume("r1"),
    ]);
    expect(claims.filter(Boolean)).toHaveLength(1);
    expect(driver.rows.get("r1")!.phase).toBe("plan_resuming");
  });

  it("reports false when the run finished before the gate", async () => {
    const { store } = await seeded();
    await store.finish("r1", "failed", "boom");
    await expect(store.beginClarification("r1", [narrative("x")], null)).resolves.toBe(false);
  });

  it("resolves once and maps repeats / foreign owners correctly", async () => {
    const { store } = await armed();
    await expect(
      store.resolveClarification({
        ...OWNER,
        runId: "r1",
        payload: { answers: { q1: "A" }, skip: false },
      }),
    ).resolves.toBe("resumed");
    await expect(
      store.resolveClarification({
        ...OWNER,
        runId: "r1",
        payload: { answers: { q1: "B" }, skip: false },
      }),
    ).resolves.toBe("already_continued");
    await expect(
      store.resolveClarification({
        tenantId: "t2",
        userId: "u1",
        runId: "r1",
        payload: { answers: {}, skip: true },
      }),
    ).resolves.toBe("not_found");
    await expect(
      store.resolveClarification({
        ...OWNER,
        runId: "missing",
        payload: { answers: {}, skip: true },
      }),
    ).resolves.toBe("not_found");
    await expect(store.getClarificationResume("r1")).resolves.toEqual({
      answers: { q1: "A" },
      skip: false,
    });
  });

  it("expire and resume cannot both win", async () => {
    const { store } = await armed();
    const [resolved, expired] = await Promise.all([
      store.resolveClarification({
        ...OWNER,
        runId: "r1",
        payload: { answers: { q1: "A" }, skip: false },
      }),
      store.expireClarification("r1"),
    ]);
    expect(resolved).toBe("resumed");
    // Whoever lost still observes the single stored payload.
    expect(expired).toEqual({ answers: { q1: "A" }, skip: false });
    await expect(store.getClarificationResume("r1")).resolves.toEqual({
      answers: { q1: "A" },
      skip: false,
    });
  });

  it("rejects an answer submitted past the deadline", async () => {
    const { store } = await armed(-1);
    await expect(
      store.resolveClarification({
        ...OWNER,
        runId: "r1",
        payload: { answers: { q1: "late" }, skip: false },
      }),
    ).resolves.toBe("already_continued");
  });

  it("propagates database failures instead of pretending the run continued", async () => {
    const { driver, store } = await armed();
    vi.spyOn(driver.ops, "resolveClarification").mockRejectedValueOnce(new Error("db down"));
    await expect(
      store.resolveClarification({
        ...OWNER,
        runId: "r1",
        payload: { answers: {}, skip: true },
      }),
    ).rejects.toThrow("db down");
  });
});

describe("dialect result adapters", () => {
  it("reads mysql2 affectedRows from the ResultSetHeader tuple", () => {
    expect(mysqlAffectedRows([{ affectedRows: 3 }, []])).toBe(3);
    expect(mysqlAffectedRows([{ affectedRows: 0 }, []])).toBe(0);
    expect(mysqlAffectedRows({ affectedRows: 2 })).toBe(2);
    expect(mysqlAffectedRows(undefined)).toBe(0);
    expect(mysqlAffectedRows([])).toBe(0);
  });

  it("normalizes clarify payloads read back from a json column", () => {
    expect(normalizeClarifyResume(null)).toBeNull();
    expect(normalizeClarifyResume("[]")).toBeNull();
    expect(normalizeClarifyResume({ answers: { q1: "A" }, skip: false })).toEqual({
      answers: { q1: "A" },
      skip: false,
    });
    expect(normalizeClarifyResume({ answers: { q1: 3 }, skip: "yes" })).toEqual({
      answers: {},
      skip: false,
    });
    const timedOut: ClarifyResumePayload = { answers: {}, skip: true, timedOut: true };
    expect(normalizeClarifyResume(timedOut)).toEqual(timedOut);
  });
});
