import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearClarifyWaiters,
  hasClarifyWaiter,
  resolveClarifyResume,
  setClarifyWaitDirForTests,
  waitForClarifyResume,
} from "./run-wait";

describe("clarify resume waiters", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-clarify-"));
    setClarifyWaitDirForTests(tmpDir);
    clearClarifyWaiters();
  });

  afterEach(() => {
    clearClarifyWaiters();
    setClarifyWaitDirForTests(null);
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("resolves pending waiter via memory and clears it", async () => {
    const pending = waitForClarifyResume("run-a", 60_000);
    expect(hasClarifyWaiter("run-a")).toBe(true);
    expect(resolveClarifyResume("run-a", { answers: { q1: "A" }, skip: false })).toBe(true);
    await expect(pending).resolves.toEqual({ answers: { q1: "A" }, skip: false });
    expect(hasClarifyWaiter("run-a")).toBe(false);
  });

  it("picks up a resume written only to the pending file (other isolate / HMR)", async () => {
    const pending = waitForClarifyResume("run-x", 60_000);
    fs.writeFileSync(
      path.join(tmpDir, "run-x.json"),
      JSON.stringify({
        status: "resolved",
        updatedAt: Date.now(),
        payload: { answers: { q1: "cross" }, skip: false },
      }),
      "utf8",
    );
    await expect(pending).resolves.toEqual({ answers: { q1: "cross" }, skip: false });
  });

  it("resolveClarifyResume succeeds from waiting file without an in-memory waiter", () => {
    fs.writeFileSync(
      path.join(tmpDir, "run-y.json"),
      JSON.stringify({ status: "waiting", updatedAt: Date.now() }),
      "utf8",
    );
    expect(resolveClarifyResume("run-y", { answers: { q1: "disk" }, skip: false })).toBe(true);
    const doc = JSON.parse(fs.readFileSync(path.join(tmpDir, "run-y.json"), "utf8")) as {
      status: string;
      payload?: { answers?: Record<string, string> };
    };
    expect(doc.status).toBe("resolved");
    expect(doc.payload?.answers).toEqual({ q1: "disk" });
  });

  it("returns false when no waiter remains after timeout", async () => {
    vi.useFakeTimers();
    const pending = waitForClarifyResume("run-b", 1_000);
    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toEqual({ answers: {}, skip: true, timedOut: true });
    // Allow poll/timer cleanup to drop the waiting file.
    await vi.advanceTimersByTimeAsync(50);
    expect(resolveClarifyResume("run-b", { answers: { q1: "late" }, skip: false })).toBe(false);
  });
});
