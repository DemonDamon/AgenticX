import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryRunStore, type RunStore } from "./run-store";
import {
  CLARIFY_POLL_INTERVAL_MS,
  hasLiveClarifyWaiter,
  notifyClarifyResume,
  waitForClarifyResume,
} from "./run-wait";

const OWNER = { tenantId: "t1", userId: "u1" };

/** Each test gets its own store — no shared wait directory, no shared waiter map. */
async function armedRun(runId: string, ttlMs = 60_000): Promise<RunStore> {
  const store = createMemoryRunStore();
  await store.create({ ...OWNER, runId, sessionId: "s1", topic: "主题" });
  await store.beginClarification(
    runId,
    [
      {
        type: "clarify",
        runId,
        step: 1,
        total: 1,
        questionId: "q1",
        question: "方向？",
        options: [{ id: "a", label: "A" }],
        allowCustom: true,
      },
    ],
    new Date(Date.now() + ttlMs),
  );
  return store;
}

describe("clarify resume coordination", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("reads an answer written by another instance straight from the run row", async () => {
    vi.useFakeTimers();
    const store = await armedRun("run-cross");
    const pending = waitForClarifyResume(store, "run-cross", 60_000);

    // Instance B: no in-process waiter, no notification — database only.
    await expect(
      store.resolveClarification({
        ...OWNER,
        runId: "run-cross",
        payload: { answers: { q1: "A" }, skip: false },
      }),
    ).resolves.toBe("resumed");

    await vi.advanceTimersByTimeAsync(CLARIFY_POLL_INTERVAL_MS);
    await expect(pending).resolves.toEqual({ answers: { q1: "A" }, skip: false });
    const row = await store.get(OWNER.tenantId, OWNER.userId, "run-cross");
    expect(row?.status).toBe("running");
  });

  it("wakes without waiting a poll interval when the resume happened locally", async () => {
    const store = await armedRun("run-local");
    const pending = waitForClarifyResume(store, "run-local", 60_000);

    await store.resolveClarification({
      ...OWNER,
      runId: "run-local",
      payload: { answers: { q1: "B" }, skip: false },
    });
    notifyClarifyResume("run-local");

    await expect(pending).resolves.toEqual({ answers: { q1: "B" }, skip: false });
  });

  it("supports an indefinite plan gate and exposes only its local waiter", async () => {
    vi.useFakeTimers();
    const store = await armedRun("run-indefinite", 24 * 60 * 60_000);
    const pending = waitForClarifyResume(store, "run-indefinite", 0);
    expect(hasLiveClarifyWaiter("run-indefinite")).toBe(true);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(hasLiveClarifyWaiter("run-indefinite")).toBe(true);
    await store.resolveClarification({
      ...OWNER,
      runId: "run-indefinite",
      payload: { answers: { __plan_action__: "approve" }, skip: false },
    });
    notifyClarifyResume("run-indefinite");

    await expect(pending).resolves.toEqual({
      answers: { __plan_action__: "approve" },
      skip: false,
    });
    expect(hasLiveClarifyWaiter("run-indefinite")).toBe(false);
  });

  it("times out into a persisted skip payload that later resumes cannot undo", async () => {
    vi.useFakeTimers();
    const store = await armedRun("run-timeout", 1_000);
    const pending = waitForClarifyResume(store, "run-timeout", 1_000);

    await vi.advanceTimersByTimeAsync(1_000);
    await expect(pending).resolves.toEqual({ answers: {}, skip: true, timedOut: true });

    const row = await store.get(OWNER.tenantId, OWNER.userId, "run-timeout");
    expect(row?.status).toBe("running");
    await expect(
      store.resolveClarification({
        ...OWNER,
        runId: "run-timeout",
        payload: { answers: { q1: "late" }, skip: false },
      }),
    ).resolves.toBe("already_continued");
    await expect(store.getClarificationResume("run-timeout")).resolves.toEqual({
      answers: {},
      skip: true,
      timedOut: true,
    });
  });

  it("returns the answer, not the skip payload, when a resume beat the deadline", async () => {
    vi.useFakeTimers();
    const store = await armedRun("run-race", 1_000);
    const pending = waitForClarifyResume(store, "run-race", 1_000);

    await store.resolveClarification({
      ...OWNER,
      runId: "run-race",
      payload: { answers: { q1: "winner" }, skip: false },
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(pending).resolves.toEqual({ answers: { q1: "winner" }, skip: false });
  });

  it("keeps polling through transient database read failures", async () => {
    vi.useFakeTimers();
    const store = await armedRun("run-flaky");
    const readSpy = vi
      .spyOn(store, "getClarificationResume")
      .mockRejectedValueOnce(new Error("connection reset"));

    const pending = waitForClarifyResume(store, "run-flaky", 60_000);
    await vi.advanceTimersByTimeAsync(CLARIFY_POLL_INTERVAL_MS);
    expect(readSpy).toHaveBeenCalledTimes(2);

    await store.resolveClarification({
      ...OWNER,
      runId: "run-flaky",
      payload: { answers: { q1: "C" }, skip: false },
    });
    await vi.advanceTimersByTimeAsync(CLARIFY_POLL_INTERVAL_MS);
    await expect(pending).resolves.toEqual({ answers: { q1: "C" }, skip: false });
  });
});
