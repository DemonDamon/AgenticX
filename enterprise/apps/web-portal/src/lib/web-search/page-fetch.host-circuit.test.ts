import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HOST_FAILURE_THRESHOLD,
  fetchPagesBatch,
} from "./page-fetch";
import type { DirectFetch } from "./direct-fetch";

describe("fetchPagesBatch host circuit breaker", () => {
  afterEach(() => {
    delete process.env.AGX_PAGE_FETCH_VERBOSE;
    vi.restoreAllMocks();
  });

  it("stops retrying a host after threshold network failures and keeps order", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => {
      throw new Error("fetch failed");
    });

    const urls = Array.from({ length: 10 }, (_, i) => `https://bad.example.com/p${i}`);
    const { pages, stats } = await fetchPagesBatch(urls, {
      fetchImpl: fetchImpl as DirectFetch,
      backends: ["native"],
      concurrency: 1,
      timeoutMs: 500,
    });

    expect(pages).toHaveLength(10);
    expect(pages.every((p) => p === null)).toBe(true);
    // native only — each attempted URL calls fetchImpl once until host is tripped.
    expect(fetchImpl.mock.calls.length).toBeLessThanOrEqual(HOST_FAILURE_THRESHOLD);
    expect(stats.network_error).toBeGreaterThanOrEqual(HOST_FAILURE_THRESHOLD);
    // Default path: one batch summary warn, not one warn per URL.
    expect(warnSpy.mock.calls.length).toBeLessThanOrEqual(2);
    expect(
      warnSpy.mock.calls.some((call) => String(call[0]).includes("[page-fetch] batch:")),
    ).toBe(true);
  });
});
