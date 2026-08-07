import { afterEach, describe, expect, it, vi } from "vitest";

describe("deep-research budget env overrides", () => {
  afterEach(() => {
    delete process.env.DEEP_RESEARCH_TOTAL_BUDGET_MS;
    delete process.env.DEEP_RESEARCH_FETCH_BUDGET_MS;
    vi.resetModules();
  });

  it("uses DEEP_RESEARCH_TOTAL_BUDGET_MS when set", async () => {
    process.env.DEEP_RESEARCH_TOTAL_BUDGET_MS = "900000";
    vi.resetModules();
    const mod = await import("./orchestrator");
    expect(mod.TOTAL_BUDGET_MS).toBe(900_000);
  });

  it("falls back to 1_200_000 when env unset", async () => {
    delete process.env.DEEP_RESEARCH_TOTAL_BUDGET_MS;
    vi.resetModules();
    const mod = await import("./orchestrator");
    expect(mod.TOTAL_BUDGET_MS).toBe(1_200_000);
  });
});
