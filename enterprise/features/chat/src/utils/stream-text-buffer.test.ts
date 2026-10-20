import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createStreamTextBuffer } from "./stream-text-buffer";

describe("stream text batching", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows the first delta immediately and coalesces a burst without altering text", async () => {
    const write = vi.fn();
    const writer = createStreamTextBuffer(write);
    writer.push("首字");
    expect(write).toHaveBeenCalledExactlyOnceWith("首字");
    const text = "<think>思考</think>\n```html\n<h1>你好 😀</h1>\n```\n".repeat(30);
    for (const character of text) writer.push(character);
    expect(write).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(80);
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls.map(([delta]) => delta).join("")).toBe("首字" + text);
    writer.stop();
  });

  it("reduces redraw frequency for long replies and flushes a cancelled tail", async () => {
    const write = vi.fn();
    const writer = createStreamTextBuffer(write, 20000);
    writer.push("first");
    writer.push("buffered tail");
    await vi.advanceTimersByTimeAsync(80);
    expect(write).toHaveBeenCalledTimes(1);
    writer.stop();
    expect(write).toHaveBeenLastCalledWith("buffered tail");
    writer.push("late chunk");
    await vi.advanceTimersByTimeAsync(1000);
    expect(write).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("flushes a final frame synchronously and isolates independent streams", () => {
    const a = vi.fn(), b = vi.fn();
    const first = createStreamTextBuffer(a), second = createStreamTextBuffer(b);
    first.push("a"); first.push("b"); second.push("other");
    first.flush();
    expect(a.mock.calls.flat()).toEqual(["a", "b"]);
    expect(b.mock.calls.flat()).toEqual(["other"]);
    first.stop(); second.stop();
  });

  it("routes timer write failures back to the stream error handler", async () => {
    const write = vi.fn().mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw new Error("render failed"); });
    const writer = createStreamTextBuffer(write);
    writer.push("first"); writer.push("next");
    await vi.advanceTimersByTimeAsync(80);
    expect(() => writer.push("tail")).toThrow("render failed");
    expect(() => writer.stop()).not.toThrow();
  });
});
