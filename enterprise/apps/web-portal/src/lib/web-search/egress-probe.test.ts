import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { probeEgress, resetEgressProbeForTests } from "./egress-probe";
import type { DirectFetch } from "./direct-fetch";

describe("probeEgress", () => {
  beforeEach(() => {
    resetEgressProbeForTests();
  });

  afterEach(() => {
    resetEgressProbeForTests();
  });

  it("returns false when all probe targets fail", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(probeEgress(fetchImpl as DirectFetch, () => 1_000)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("caches the result within TTL and does not re-fetch", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    const now = vi
      .fn<() => number>()
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(30_000);

    await expect(probeEgress(fetchImpl as DirectFetch, now)).resolves.toBe(false);
    const callsAfterFirst = fetchImpl.mock.calls.length;
    await expect(probeEgress(fetchImpl as DirectFetch, now)).resolves.toBe(false);
    expect(fetchImpl.mock.calls.length).toBe(callsAfterFirst);
  });

  it("returns true when any probe target responds with status > 0", async () => {
    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    await expect(probeEgress(fetchImpl as DirectFetch, () => 1_000)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
