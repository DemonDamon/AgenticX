import { afterEach, describe, expect, it, vi } from "vitest";

// 这两条用例都要 vi.resetModules() 之后重新 import 整个 orchestrator 模块图
// （它拉起 web-search、policy、report 一大串依赖），冷编译一次就要好几秒。
// vitest 默认 5s 上限算的是"从 it 开始到 resolve"，import 的时间也在里面，
// 所以 134 个测试文件并行跑的时候这里必然超时。给它们单独放宽到 30s。
const IMPORT_HEAVY_TIMEOUT_MS = 30_000;

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
  }, IMPORT_HEAVY_TIMEOUT_MS);

  it("falls back to 1_200_000 when env unset", async () => {
    delete process.env.DEEP_RESEARCH_TOTAL_BUDGET_MS;
    vi.resetModules();
    const mod = await import("./orchestrator");
    expect(mod.TOTAL_BUDGET_MS).toBe(1_200_000);
  }, IMPORT_HEAVY_TIMEOUT_MS);
});
