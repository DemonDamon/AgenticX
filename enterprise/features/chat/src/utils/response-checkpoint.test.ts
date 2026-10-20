import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResponseCheckpoint } from "./response-checkpoint";

describe("response checkpoints", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function setup() {
    let content = "existing prefix";
    const save = vi.fn().mockResolvedValue(undefined);
    const onError = vi.fn();
    const checkpoint = createResponseCheckpoint({ read: () => ({ content }), save, onError });
    return { save, onError, checkpoint, append(delta: string) { content += delta; checkpoint.changed(); } };
  }

  it("saves 2000 new characters at most once per 5 seconds and coalesces tokens", async () => {
    const run = setup();
    for (let i = 0; i < 2100; i++) run.append("字");
    await vi.advanceTimersByTimeAsync(4999);
    expect(run.save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(run.save).toHaveBeenCalledExactlyOnceWith({ content: "existing prefix" + "字".repeat(2100) });
    run.append("x".repeat(2200));
    await vi.advanceTimersByTimeAsync(5000);
    expect(run.save).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(run.save).toHaveBeenCalledTimes(2);
    run.checkpoint.stop();
  });

  it("bounds slow-output loss to 15 seconds without an idle polling loop", async () => {
    const run = setup();
    run.append("少量输出");
    await vi.advanceTimersByTimeAsync(14000);
    run.append("仍在输出");
    await vi.advanceTimersByTimeAsync(1000);
    expect(run.save).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("saves the first small response early, then batches further output", async () => {
    let content = "";
    const save = vi.fn().mockResolvedValue(undefined);
    const checkpoint = createResponseCheckpoint({ read: () => ({ content }), save, onError: vi.fn() });
    content = "首段思考";
    checkpoint.changed();
    await vi.advanceTimersByTimeAsync(999);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledExactlyOnceWith({ content: "首段思考" });
    content += "随后的一小段";
    checkpoint.changed();
    await vi.advanceTimersByTimeAsync(14_999);
    expect(save).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledTimes(2);
    checkpoint.stop();
  });

  it("never overlaps writes and does not resurrect a stopped checkpoint", async () => {
    const run = setup();
    let release!: () => void;
    run.save.mockImplementationOnce(() => new Promise<void>((resolve) => { release = resolve; }));
    run.append("x".repeat(2100));
    await vi.advanceTimersByTimeAsync(5000);
    run.append("y".repeat(2100));
    await vi.advanceTimersByTimeAsync(60000);
    expect(run.save).toHaveBeenCalledTimes(1);
    run.checkpoint.stop();
    release();
    await vi.advanceTimersByTimeAsync(60000);
    expect(run.save).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("reports a failed write and throttles retry instead of spinning", async () => {
    const run = setup();
    run.save.mockRejectedValueOnce(new Error("offline"));
    run.append("x".repeat(2100));
    await vi.advanceTimersByTimeAsync(5000);
    expect(run.onError).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(run.save).toHaveBeenCalledTimes(2);
    run.checkpoint.stop();
  });
});
