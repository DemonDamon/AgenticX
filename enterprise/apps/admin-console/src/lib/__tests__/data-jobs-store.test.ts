import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FAIL_WEBHOOK_KIND,
  backfillJob,
  ensureSampleJob,
  listRuns,
  listWebhookEvents,
  replayJob,
  resetJobsStoreForTests,
  rerunJob,
  tickJob,
} from "../data-jobs-store";

describe("data-jobs-store", () => {
  const prev = process.env.AGX_DATA_SUITE_STORE_DIR;

  beforeEach(async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "agx-jobs-"));
    process.env.AGX_DATA_SUITE_STORE_DIR = dir;
    await resetJobsStoreForTests();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.AGX_DATA_SUITE_STORE_DIR;
    else process.env.AGX_DATA_SUITE_STORE_DIR = prev;
  });

  it("seeds golden job and records tick + rerun history", async () => {
    const seeded = await ensureSampleJob();
    expect(seeded.job.id).toBe("golden_path_members");
    expect(seeded.schedule.cron).toBe("0 3 * * *");

    const ticks = await tickJob();
    expect(ticks).toHaveLength(1);
    expect(ticks[0]?.trigger).toBe("schedule");
    expect(ticks[0]?.status).toBe("succeeded");
    expect(ticks[0]?.snapshot_id).toBeTruthy();

    const rerun = await rerunJob();
    expect(rerun.trigger).toBe("manual");
    expect(rerun.status).toBe("succeeded");

    const history = await listRuns({ job_id: "golden_path_members" });
    expect(history.length).toBeGreaterThanOrEqual(2);
    expect(history.some((r) => r.trigger === "schedule")).toBe(true);
    expect(history.some((r) => r.trigger === "manual")).toBe(true);
  });

  it("backfill and replay entry", async () => {
    const [tick] = await tickJob();
    const bf = await backfillJob(undefined, "2026-10-01T03:00:00.000Z");
    expect(bf.trigger).toBe("backfill");
    expect(bf.scheduled_for).toBe("2026-10-01T03:00:00.000Z");

    const replay = await replayJob(undefined, tick!.snapshot_id!);
    expect(replay.trigger).toBe("replay");
    expect(replay.replay_of_snapshot_id).toBe(tick!.snapshot_id);
  });

  it("force_fail tick emits webhook event", async () => {
    const runs = await tickJob({ force_fail: true });
    const run = runs[0];
    expect(run).toBeDefined();
    expect(run!.status).toBe("failed");
    const events = await listWebhookEvents();
    expect(events.some((e) => e.kind === FAIL_WEBHOOK_KIND)).toBe(true);
  });
});
