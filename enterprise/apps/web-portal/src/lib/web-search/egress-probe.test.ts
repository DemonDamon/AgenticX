import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { egressProbeTargets, probeEgress, resetEgressProbeForTests } from "./egress-probe";
import type { DirectFetch } from "./direct-fetch";

describe("probeEgress", () => {
  beforeEach(() => {
    resetEgressProbeForTests();
    delete process.env.DEEP_RESEARCH_EGRESS_PROBE_TARGETS;
  });

  afterEach(() => {
    resetEgressProbeForTests();
    delete process.env.DEEP_RESEARCH_EGRESS_PROBE_TARGETS;
  });

  it("returns false when all probe targets fail", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    });

    await expect(probeEgress(fetchImpl as DirectFetch, () => 1_000)).resolves.toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(egressProbeTargets().length);
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
  });

  it("counts a CN-reachable target as egress even when the blocked ones fail", async () => {
    // 国内机器够不到 duckduckgo 是常态，不是「这台机器没网」。
    const fetchImpl = vi.fn(async (input: string | URL) => {
      const url = String(input);
      if (url.includes("baidu.com")) return new Response("ok", { status: 200 });
      throw new Error("blocked");
    });

    await expect(probeEgress(fetchImpl as unknown as DirectFetch, () => 1_000)).resolves.toBe(
      true,
    );
  });

  it("probes every target concurrently so an isolated network waits one timeout", async () => {
    // 串行时隔离网络要等 targets × 4s 才开跑，这是拒绝加目标的真正原因。
    let inFlight = 0;
    let peak = 0;
    const fetchImpl = vi.fn(async () => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 5));
      inFlight -= 1;
      throw new Error("network down");
    });

    await expect(probeEgress(fetchImpl as DirectFetch, () => 1_000)).resolves.toBe(false);
    expect(peak).toBe(egressProbeTargets().length);
  });

  it("lets an air-gapped deployment point the probe at its own mirror", async () => {
    process.env.DEEP_RESEARCH_EGRESS_PROBE_TARGETS = "https://mirror.corp.internal";
    expect(egressProbeTargets()).toEqual(["https://mirror.corp.internal"]);

    const fetchImpl = vi.fn(async () => new Response("ok", { status: 200 }));
    await expect(probeEgress(fetchImpl as DirectFetch, () => 1_000)).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String(fetchImpl.mock.calls[0]![0])).toBe("https://mirror.corp.internal");
  });
});
