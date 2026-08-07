import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { directFetch, resetCurlProbeForTests } from "./direct-fetch";

function makeFailingSpawn() {
  return {
    stdout: { on: vi.fn(), resume: vi.fn() },
    stderr: { on: vi.fn(), resume: vi.fn() },
    stdin: { write: vi.fn(), end: vi.fn() },
    kill: vi.fn(),
    on: (event: string, cb: (...args: unknown[]) => void) => {
      if (event === "error") {
        queueMicrotask(() => cb(new Error("ENOENT")));
      }
      return undefined;
    },
  };
}

describe("directFetch curl probe", () => {
  beforeEach(() => {
    resetCurlProbeForTests();
    spawnMock.mockReset();
    delete process.env.AGX_DISABLE_CURL_FETCH;
  });

  afterEach(() => {
    resetCurlProbeForTests();
    delete process.env.AGX_DISABLE_CURL_FETCH;
  });

  it("skips curl spawn entirely when AGX_DISABLE_CURL_FETCH=1", async () => {
    process.env.AGX_DISABLE_CURL_FETCH = "1";
    await expect(directFetch("http://127.0.0.1:1/probe")).rejects.toBeTruthy();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("caches a failed curl probe so subsequent fetches do not re-spawn", async () => {
    spawnMock.mockImplementation(() => makeFailingSpawn());

    for (let i = 0; i < 5; i += 1) {
      await expect(directFetch("http://127.0.0.1:1/probe")).rejects.toBeTruthy();
    }

    // One probe spawn only; curl fetch path is never entered after a failed probe.
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(spawnMock.mock.calls[0]?.[1]).toEqual(["--version"]);
  });
});
