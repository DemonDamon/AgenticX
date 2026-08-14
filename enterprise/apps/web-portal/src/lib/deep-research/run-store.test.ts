import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  MAX_EVENTS_PER_RUN,
  RUN_FLUSH_INTERVAL_MS,
  createMemoryRunStore,
  createRunWriter,
  newEventsSince,
  runLooksFinished,
  trimEvents,
} from "./run-store";
import type { DeepResearchEvent } from "@agenticx/sdk-ts";

function progress(i: number): DeepResearchEvent {
  return { type: "lane_progress", laneId: "l1", message: `p${i}` };
}

describe("trimEvents", () => {
  it("drops transient reasoning before durable research events", () => {
    const reasoning: DeepResearchEvent = {
      type: "reasoning",
      id: "section-core",
      phase: "synthesize",
      title: "核心结论",
      text: "过程文本",
      kind: "reasoning",
    };
    const events: DeepResearchEvent[] = [
      { type: "run_started", runId: "r1" },
      reasoning,
      ...Array.from({ length: MAX_EVENTS_PER_RUN - 1 }, (): DeepResearchEvent => ({
        type: "lane_done",
        laneId: "l1",
        status: "ok",
      })),
      { type: "artifact", id: "a1", path: "report.md", title: "报告", kind: "report", bytes: 1 },
    ];
    const trimmed = trimEvents(events);
    expect(trimmed.some((event) => event.type === "reasoning")).toBe(false);
    expect(trimmed.some((event) => event.type === "artifact")).toBe(true);
  });

  it("prefers dropping lane_progress while keeping run_started and clarify", () => {
    const events: DeepResearchEvent[] = [
      { type: "run_started", runId: "r1" },
      {
        type: "clarify",
        runId: "r1",
        step: 1,
        total: 1,
        questionId: "q1",
        question: "方向？",
        options: [{ id: "a", label: "A" }],
        allowCustom: true,
      },
      ...Array.from({ length: MAX_EVENTS_PER_RUN }, (_, i) => progress(i)),
    ];
    const trimmed = trimEvents(events);
    expect(trimmed.length).toBeLessThanOrEqual(MAX_EVENTS_PER_RUN);
    expect(trimmed.some((e) => e.type === "run_started")).toBe(true);
    expect(trimmed.some((e) => e.type === "clarify")).toBe(true);
    expect(trimmed.filter((e) => e.type === "lane_progress").length).toBeLessThan(
      events.filter((e) => e.type === "lane_progress").length,
    );
  });

  it("drops lane_sources only after lane_progress is exhausted", () => {
    const laneSources: DeepResearchEvent = {
      type: "lane_sources",
      laneId: "l1",
      sources: [{ title: "t", url: "https://example.com" }],
    };
    const events: DeepResearchEvent[] = [
      { type: "run_started", runId: "r1" },
      laneSources,
      ...Array.from({ length: 10 }, (_, i) => progress(i)),
      ...Array.from({ length: MAX_EVENTS_PER_RUN }, (): DeepResearchEvent => {
        return { type: "lane_done", laneId: "l1", status: "ok" };
      }),
    ];
    const trimmed = trimEvents(events);
    expect(trimmed.some((e) => e.type === "run_started")).toBe(true);
    // lane_progress goes first, so none survive while lane_sources is still around.
    expect(trimmed.filter((e) => e.type === "lane_progress")).toHaveLength(0);

    const fewer: DeepResearchEvent[] = [
      { type: "run_started", runId: "r1" },
      laneSources,
      progress(0),
      ...Array.from({ length: MAX_EVENTS_PER_RUN - 3 }, (): DeepResearchEvent => {
        return { type: "lane_done", laneId: "l1", status: "ok" };
      }),
      { type: "lane_done", laneId: "l1", status: "ok" },
    ];
    const trimmedFewer = trimEvents(fewer);
    expect(trimmedFewer.some((e) => e.type === "lane_sources")).toBe(true);
    expect(trimmedFewer.some((e) => e.type === "lane_progress")).toBe(false);
  });
});

describe("memory run store", () => {
  it("create → appendEvents → get returns ordered events (AC-2)", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "主题",
    });
    await store.appendEvents(
      "r1",
      [
        { type: "run_started", runId: "r1" },
        { type: "phase", phase: "plan", message: "规划中" },
      ],
      { phase: "plan" },
    );
    const row = await store.get("t1", "u1", "r1");
    expect(row).not.toBeNull();
    expect(row!.events.map((e) => e.type)).toEqual(["run_started", "phase"]);
    expect(row!.eventSeq).toBe(2);
    expect(row!.phase).toBe("plan");
  });

  it("round-trips optional lane retrieval trace", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "主题",
    });
    const event: DeepResearchEvent = {
      type: "lane_sources",
      laneId: "l1",
      sources: [],
      trace: {
        queries: [
          {
            query: "主题 最新",
            kind: "recency",
            status: "empty",
            hitCount: 0,
            providerIds: ["customer-primary"],
          },
          { query: "主题 论文", kind: "authority", status: "skipped", hitCount: 0 },
        ],
        topLevelQueriesRun: 1,
        providerCalls: 1,
        candidateCount: 0,
        selectedCount: 0,
        uniqueHosts: 0,
      },
    };
    await store.appendEvents("r1", [event]);
    const row = await store.get("t1", "u1", "r1");
    expect(row?.events[0]).toEqual(event);
  });

  it("drops lane_progress first when over MAX_EVENTS_PER_RUN", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "主题",
    });
    const burst: DeepResearchEvent[] = [
      { type: "run_started", runId: "r1" },
      {
        type: "clarify",
        runId: "r1",
        step: 1,
        total: 1,
        questionId: "q1",
        question: "方向？",
        options: [{ id: "a", label: "A" }],
        allowCustom: true,
      },
      ...Array.from({ length: MAX_EVENTS_PER_RUN }, (_, i) => progress(i)),
    ];
    await store.appendEvents("r1", burst);
    const row = await store.get("t1", "u1", "r1");
    expect(row!.events.length).toBeLessThanOrEqual(MAX_EVENTS_PER_RUN);
    expect(row!.events.some((e) => e.type === "run_started")).toBe(true);
    expect(row!.events.some((e) => e.type === "clarify")).toBe(true);
  });

  it("appendReport concatenates chunks", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "主题",
    });
    await store.appendReport("r1", "# Title\n");
    await store.appendReport("r1", "## Sec\n");
    const row = await store.get("t1", "u1", "r1");
    expect(row!.reportMarkdown).toBe("# Title\n## Sec\n");
  });

  it("finish(failed) locks terminal status; further appendEvents ignored", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "主题",
    });
    await store.finish("r1", "failed", "boom");
    await store.appendEvents("r1", [{ type: "narrative", text: "should not stick" }]);
    const row = await store.get("t1", "u1", "r1");
    expect(row!.status).toBe("failed");
    expect(row!.errorMessage).toBe("boom");
    expect(row!.events).toHaveLength(0);
  });

  it("persists the final error after a terminal phase event set the same status", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "主题",
    });
    await store.appendEvents(
      "r1",
      [{ type: "phase", phase: "done", message: "已达到时间预算" }],
      { status: "failed", phase: "done" },
    );
    await store.finish("r1", "failed", "active-time deadline exceeded");

    const row = await store.get("t1", "u1", "r1");
    expect(row?.status).toBe("failed");
    expect(row?.errorMessage).toBe("active-time deadline exceeded");
  });

  it("runLooksFinished detects delivered final report while status still running", () => {
    expect(
      runLooksFinished({
        phase: "synthesize",
        reportMarkdown: "# report\n\nbody",
        events: [
          {
            type: "artifact",
            id: "a1",
            path: "research/r1/final-report.md",
            title: "终稿",
            kind: "report",
            bytes: 1,
          },
        ],
      }),
    ).toBe(true);
    expect(
      runLooksFinished({
        phase: "synthesize",
        reportMarkdown: "x".repeat(2_500),
        events: [{ type: "phase", phase: "synthesize", message: "撰写中" }],
      }),
    ).toBe(false);
    expect(
      runLooksFinished({
        phase: "lanes",
        reportMarkdown: "",
        events: [{ type: "phase", phase: "lanes", message: "检索中" }],
      }),
    ).toBe(false);
  });

  it("getLatestBySession returns most recently updated run", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "old",
    });
    await store.finish("r1", "completed");
    await store.create({
      runId: "r2",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "new",
    });
    // Ensure r2 is strictly newer even when creates share the same ms timestamp.
    await new Promise((r) => setTimeout(r, 5));
    await store.appendEvents("r2", [{ type: "narrative", text: "bump" }]);
    const latest = await store.getLatestBySession("t1", "u1", "s1");
    expect(latest?.runId).toBe("r2");
  });

  it("listActive only returns running / awaiting_clarify", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "A",
    });
    await store.create({
      runId: "r2",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "B",
    });
    await store.create({
      runId: "r3",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s2",
      topic: "C",
    });
    await store.appendEvents("r2", [], { status: "awaiting_clarify" });
    await store.finish("r3", "completed");
    const active = await store.listActive("t1", "u1", "s1");
    expect(active.map((r) => r.runId).sort()).toEqual(["r1", "r2"]);
    expect(active.every((r) => r.status === "running" || r.status === "awaiting_clarify")).toBe(
      true,
    );
  });

  it("denies cross-tenant get", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "主题",
    });
    expect(await store.get("t2", "u1", "r1")).toBeNull();
    expect(await store.get("t1", "u2", "r1")).toBeNull();
  });

  it("keeps the first terminal status; a later different outcome cannot overwrite it", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "主题",
    });
    await store.finish("r1", "completed");
    await store.finish("r1", "failed", "late failure");
    await store.finish("r1", "cancelled");
    const row = await store.get("t1", "u1", "r1");
    expect(row?.status).toBe("completed");
    expect(row?.errorMessage).toBeUndefined();
  });

  it("does not resurrect a finished run through a late report append", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "主题",
    });
    await store.appendReport("r1", "# 正文\n");
    await store.finish("r1", "completed");
    await store.appendReport("r1", "迟到的尾巴");
    const row = await store.get("t1", "u1", "r1");
    expect(row?.status).toBe("completed");
    expect(row?.reportMarkdown).toBe("# 正文\n");
  });

  it("reapStaleRuns skips runs that were touched inside the window", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "fresh",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "A",
    });
    await store.create({
      runId: "done",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "B",
    });
    await store.finish("done", "completed");
    // Window is 1h; both rows were just written, so nothing is stale.
    expect(await store.reapStaleRuns(3_600_000)).toBe(0);
    expect((await store.get("t1", "u1", "fresh"))?.status).toBe("running");
    expect((await store.get("t1", "u1", "done"))?.status).toBe("completed");
    // Everything older than "now" is stale — only the active run is reaped.
    expect(await store.reapStaleRuns(-1)).toBe(1);
    expect((await store.get("t1", "u1", "fresh"))?.status).toBe("failed");
    expect((await store.get("t1", "u1", "done"))?.status).toBe("completed");
  });

  it("bumps revision on every mutation", async () => {
    const store = createMemoryRunStore();
    const created = await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "主题",
    });
    expect(created.revision).toBe(0);
    await store.appendEvents("r1", [{ type: "narrative", text: "一" }]);
    await store.appendReport("r1", "chunk");
    await store.setCitations("r1", []);
    expect((await store.get("t1", "u1", "r1"))?.revision).toBe(3);
  });
});

describe("clarify coordination", () => {
  const OWNER = { tenantId: "t1", userId: "u1" };

  async function armed(runId = "r1", ttlMs: number | null = 60_000) {
    const store = createMemoryRunStore();
    await store.create({ ...OWNER, runId, sessionId: "s1", topic: "主题" });
    const armedOk = await store.beginClarification(
      runId,
      [{ type: "narrative", text: "请确认方向" }],
      ttlMs === null ? null : new Date(Date.now() + ttlMs),
    );
    return { store, armedOk };
  }

  it("beginClarification persists the events and flips to awaiting_clarify", async () => {
    const { store, armedOk } = await armed();
    expect(armedOk).toBe(true);
    const row = await store.get(OWNER.tenantId, OWNER.userId, "r1");
    expect(row?.status).toBe("awaiting_clarify");
    expect(row?.phase).toBe("clarify");
    expect(row?.events).toHaveLength(1);
    expect(row?.eventSeq).toBe(1);
    expect(await store.getClarificationResume("r1")).toBeNull();
  });

  it("refuses to arm a run that already finished", async () => {
    const store = createMemoryRunStore();
    await store.create({ ...OWNER, runId: "r1", sessionId: "s1", topic: "主题" });
    await store.finish("r1", "cancelled");
    expect(await store.beginClarification("r1", [], null)).toBe(false);
  });

  it("accepts only the first answer and reports repeats as already continued", async () => {
    const { store } = await armed();
    await expect(
      store.resolveClarification({
        ...OWNER,
        runId: "r1",
        payload: { answers: { q1: "first" }, skip: false },
      }),
    ).resolves.toBe("resumed");
    await expect(
      store.resolveClarification({
        ...OWNER,
        runId: "r1",
        payload: { answers: { q1: "second" }, skip: false },
      }),
    ).resolves.toBe("already_continued");
    expect(await store.getClarificationResume("r1")).toEqual({
      answers: { q1: "first" },
      skip: false,
    });
    expect((await store.get(OWNER.tenantId, OWNER.userId, "r1"))?.status).toBe("running");
  });

  it("returns not_found for cross-tenant and cross-user resume attempts", async () => {
    const { store } = await armed();
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
        tenantId: "t1",
        userId: "u2",
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
    // The run is still waiting for its rightful owner.
    expect(await store.getClarificationResume("r1")).toBeNull();
  });

  it("rejects a resume that arrives after the clarify deadline", async () => {
    const { store } = await armed("r1", 1_000);
    await expect(
      store.resolveClarification({
        ...OWNER,
        runId: "r1",
        payload: { answers: { q1: "late" }, skip: false },
        now: new Date(Date.now() + 5_000),
      }),
    ).resolves.toBe("already_continued");
    expect(await store.getClarificationResume("r1")).toBeNull();
  });

  it("expireClarification yields the resume payload when the answer won the race", async () => {
    const { store } = await armed();
    await store.resolveClarification({
      ...OWNER,
      runId: "r1",
      payload: { answers: { q1: "winner" }, skip: false },
    });
    await expect(store.expireClarification("r1")).resolves.toEqual({
      answers: { q1: "winner" },
      skip: false,
    });
  });

  it("expireClarification writes the skip payload exactly once", async () => {
    const { store } = await armed();
    await expect(store.expireClarification("r1")).resolves.toEqual({
      answers: {},
      skip: true,
      timedOut: true,
    });
    await expect(store.expireClarification("r1")).resolves.toEqual({
      answers: {},
      skip: true,
      timedOut: true,
    });
    expect((await store.get(OWNER.tenantId, OWNER.userId, "r1"))?.status).toBe("running");
  });
});

describe("newEventsSince", () => {
  it("returns only newly appended tail events without duplicates", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "主题",
    });
    await store.appendEvents("r1", [
      { type: "run_started", runId: "r1" },
      { type: "phase", phase: "lanes", message: "检索" },
    ]);
    let row = (await store.get("t1", "u1", "r1"))!;
    expect(newEventsSince(row, 0).map((e) => e.type)).toEqual(["run_started", "phase"]);
    const watermark = row.eventSeq;
    await store.appendEvents("r1", [{ type: "narrative", text: "继续" }]);
    row = (await store.get("t1", "u1", "r1"))!;
    expect(newEventsSince(row, watermark).map((e) => e.type)).toEqual(["narrative"]);
    expect(newEventsSince(row, row.eventSeq)).toEqual([]);
  });
});

describe("createRunWriter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("batches multiple push calls into one appendEvents within flush interval", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "主题",
    });
    const appendSpy = vi.spyOn(store, "appendEvents");
    const writer = createRunWriter(store, "r1");
    writer.push({ type: "run_started", runId: "r1" });
    writer.push({ type: "phase", phase: "lanes", message: "检索中" });
    writer.push({ type: "narrative", text: "开始" });
    expect(appendSpy).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RUN_FLUSH_INTERVAL_MS);
    expect(appendSpy).toHaveBeenCalledTimes(1);
    expect(appendSpy.mock.calls[0]![1]).toHaveLength(3);
    const row = await store.get("t1", "u1", "r1");
    expect(row!.events).toHaveLength(3);
    expect(row!.phase).toBe("lanes");
  });

  it("coalesces reasoning snapshots from the same stage across flushes", async () => {
    const store = createMemoryRunStore();
    await store.create({
      runId: "r1",
      tenantId: "t1",
      userId: "u1",
      sessionId: "s1",
      topic: "主题",
    });
    const writer = createRunWriter(store, "r1");
    writer.push({
      type: "reasoning",
      id: "section-core",
      phase: "synthesize",
      title: "核心结论",
      text: "第一版",
      kind: "draft",
    });
    await writer.flush();
    writer.push({
      type: "reasoning",
      id: "section-core",
      phase: "synthesize",
      title: "核心结论",
      text: "第二版",
      kind: "draft",
      done: true,
    });
    await writer.flush();
    const row = await store.get("t1", "u1", "r1");
    expect(row?.events).toEqual([
      expect.objectContaining({ type: "reasoning", text: "第二版", done: true }),
    ]);
  });
});
