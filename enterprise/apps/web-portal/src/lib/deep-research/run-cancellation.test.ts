import { describe, expect, it, vi } from "vitest";
import type { RunStore } from "./run-store";
import { watchRunCancellation } from "./run-cancellation";

describe("watchRunCancellation", () => {
  it("aborts when the stored run is cancelled", async () => {
    vi.useFakeTimers();
    const store = {
      get: vi.fn(async () => ({ status: "running" })),
    };
    const onAbort = vi.fn();
    const watch = watchRunCancellation(
      store as unknown as RunStore,
      { tenantId: "t", userId: "u", runId: "r" },
      onAbort,
      1_000,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(watch.signal.aborted).toBe(false);
    store.get.mockResolvedValue({ status: "cancelled" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(watch.signal.aborted).toBe(true);
    expect(onAbort).toHaveBeenCalledTimes(1);
    watch.dispose();
    vi.useRealTimers();
  });
});
