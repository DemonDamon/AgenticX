import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GatewayStreamIdleTimeoutError,
  PausableDeadline,
  readStreamWithIdleTimeout,
} from "./deadline";

afterEach(() => {
  vi.useRealTimers();
});

describe("PausableDeadline", () => {
  it("aborts at the active-time deadline", async () => {
    vi.useFakeTimers();
    const deadline = new PausableDeadline(1_000);
    await vi.advanceTimersByTimeAsync(999);
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(deadline.signal.aborted).toBe(true);
    expect(deadline.expired).toBe(true);
    expect((deadline.signal.reason as DOMException).name).toBe("TimeoutError");
  });

  it("does not charge time spent waiting for clarification", async () => {
    vi.useFakeTimers();
    const deadline = new PausableDeadline(1_000);
    await vi.advanceTimersByTimeAsync(400);
    deadline.pause();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(deadline.signal.aborted).toBe(false);
    deadline.resume();
    await vi.advanceTimersByTimeAsync(599);
    expect(deadline.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(deadline.signal.aborted).toBe(true);
  });
});

describe("readStreamWithIdleTimeout", () => {
  it("rejects and cancels a stream that stops producing chunks", async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull() {
        // Keep the read pending.
      },
      cancel() {
        cancelled = true;
      },
    });
    const pending = readStreamWithIdleTimeout(stream.getReader(), 500);
    const assertion = expect(pending).rejects.toBeInstanceOf(GatewayStreamIdleTimeoutError);
    await vi.advanceTimersByTimeAsync(500);
    await assertion;
    expect(cancelled).toBe(true);
  });

  it("propagates the shared run abort signal", async () => {
    const controller = new AbortController();
    const stream = new ReadableStream<Uint8Array>({ pull() {} });
    const pending = readStreamWithIdleTimeout(stream.getReader(), 5_000, controller.signal);
    controller.abort(new DOMException("deadline", "TimeoutError"));
    await expect(pending).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
