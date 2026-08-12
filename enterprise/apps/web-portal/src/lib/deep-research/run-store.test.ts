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
    ).toBe(true);
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
});
