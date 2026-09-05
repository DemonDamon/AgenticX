import { afterEach, describe, expect, it, vi } from "vitest";
import {
  startWbBridgeProgressPoll,
  stopAllWbBridgeProgressPolls,
  stopWbBridgeProgressPoll,
} from "./wb-bridge-progress";

describe("wb-bridge-progress poll", () => {
  afterEach(() => {
    stopAllWbBridgeProgressPolls();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("fetches immediately then again after 2s, and stop ends requests", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ turn_state: "running", last_activity: "Write" }),
    });
    vi.stubGlobal("fetch", fetchMock);
    const onSnapshot = vi.fn();

    startWbBridgeProgressPoll({
      key: "call-1",
      sessionId: "11111111-1111-1111-1111-111111111111",
      apiBase: "http://127.0.0.1:9",
      apiToken: "tok",
      onSnapshot,
    });

    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    stopWbBridgeProgressPoll("call-1");
    await vi.advanceTimersByTimeAsync(4000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(onSnapshot).toHaveBeenCalled();
  });
});
