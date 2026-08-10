import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __flushDbSinkForTests,
  __getDbSinkQueueForTests,
  __isDbSinkDisabledForTests,
  __resetDbSinkForTests,
  enqueueLog,
  type PortalLogRow,
} from "./db-sink";

function row(partial: Partial<PortalLogRow> & Pick<PortalLogRow, "level" | "event">): PortalLogRow {
  return {
    tenant_id: "tenant-1",
    log_time: new Date("2026-08-10T00:00:00.000Z"),
    ...partial,
  };
}

describe("portal log db sink", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubEnv("PORTAL_LOG_DB_SINK", "on");
    vi.stubEnv("PORTAL_LOG_DB_MIN_LEVEL", "info");
  });

  afterEach(() => {
    __resetDbSinkForTests();
    vi.unstubAllEnvs();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("enqueueLog returns undefined and does not throw when insert fails", async () => {
    const insertBatch = vi.fn(async () => {
      throw new Error("db down");
    });
    __resetDbSinkForTests({ insertBatch });

    expect(enqueueLog(row({ level: "info", event: "chat.completions.finish" }))).toBeUndefined();
    await __flushDbSinkForTests();
    expect(insertBatch).toHaveBeenCalled();
  });

  it("flushes once when 50 rows are enqueued", async () => {
    const insertBatch = vi.fn(async (_rows: PortalLogRow[]) => undefined);
    __resetDbSinkForTests({ insertBatch });

    for (let i = 0; i < 50; i += 1) {
      enqueueLog(row({ level: "info", event: `evt.${i}` }));
    }
    await vi.waitFor(() => {
      expect(insertBatch).toHaveBeenCalledTimes(1);
    });
    const firstBatch = insertBatch.mock.calls[0]?.[0];
    expect(firstBatch).toHaveLength(50);
  });

  it("flushes after FLUSH_INTERVAL_MS with fewer than batch size", async () => {
    const insertBatch = vi.fn(async (_rows: PortalLogRow[]) => undefined);
    __resetDbSinkForTests({ insertBatch });

    for (let i = 0; i < 10; i += 1) {
      enqueueLog(row({ level: "info", event: `evt.${i}` }));
    }
    expect(insertBatch).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(insertBatch).toHaveBeenCalledTimes(1);
    const timedBatch = insertBatch.mock.calls[0]?.[0];
    expect(timedBatch).toHaveLength(10);
  });

  it("keeps error rows when queue overflows", () => {
    // Hang the first flush so subsequent enqueues stay in memory and exercise trimQueue.
    const insertBatch = vi.fn(() => new Promise<void>(() => undefined));
    __resetDbSinkForTests({ insertBatch });

    for (let i = 0; i < 49; i += 1) {
      enqueueLog(row({ level: "info", event: `warmup.${i}` }));
    }
    enqueueLog(row({ level: "info", event: "warmup.trigger" })); // starts hanging flush

    for (let i = 0; i < 100; i += 1) {
      enqueueLog(row({ level: "error", event: `err.${i}` }));
    }
    for (let i = 0; i < 1400; i += 1) {
      enqueueLog(row({ level: "info", event: `info.${i}` }));
    }

    const queue = __getDbSinkQueueForTests();
    const errors = queue.filter((item) => item.level === "error");
    expect(errors).toHaveLength(100);
    expect(queue.length).toBeLessThanOrEqual(1000);
  });

  it("does not call db when PORTAL_LOG_DB_SINK=off", async () => {
    vi.stubEnv("PORTAL_LOG_DB_SINK", "off");
    const insertBatch = vi.fn(async () => undefined);
    __resetDbSinkForTests({ insertBatch });

    for (let i = 0; i < 60; i += 1) {
      enqueueLog(row({ level: "info", event: `evt.${i}` }));
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(insertBatch).not.toHaveBeenCalled();
  });

  it("does not enqueue debug deep_research.runs.finish when min level is info", async () => {
    const insertBatch = vi.fn(async () => undefined);
    __resetDbSinkForTests({ insertBatch });

    enqueueLog(row({ level: "debug", event: "deep_research.runs.finish", route: "deep_research.runs" }));
    await vi.advanceTimersByTimeAsync(5000);
    expect(insertBatch).not.toHaveBeenCalled();
    expect(__getDbSinkQueueForTests()).toHaveLength(0);
  });

  it("disables after 3 consecutive insert failures", async () => {
    const insertBatch = vi.fn(async () => {
      throw new Error("db down");
    });
    __resetDbSinkForTests({ insertBatch });

    for (let round = 0; round < 3; round += 1) {
      enqueueLog(row({ level: "warn", event: `fail.${round}` }));
      await __flushDbSinkForTests();
    }
    expect(__isDbSinkDisabledForTests()).toBe(true);
    const callsAfterDisable = insertBatch.mock.calls.length;

    enqueueLog(row({ level: "error", event: "after.disable" }));
    await __flushDbSinkForTests();
    expect(insertBatch.mock.calls.length).toBe(callsAfterDisable);
  });
});
