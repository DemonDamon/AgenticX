import { describe, expect, it } from "vitest";

import {
  getServeStartupTimeoutMs,
  LOCAL_BACKEND_STARTUP_ENV,
  SERVE_READY_PROBE_TIMEOUT_MS,
} from "../electron/local-backend-startup";

describe("local backend startup stopgap", () => {
  it("keeps LiteLLM model metadata offline during Desktop boot", () => {
    expect(LOCAL_BACKEND_STARTUP_ENV).toEqual({
      LITELLM_LOCAL_MODEL_COST_MAP: "true",
    });
  });

  it("allows a slower Windows cold start without changing other platforms", () => {
    expect(getServeStartupTimeoutMs("win32")).toBe(90_000);
    expect(getServeStartupTimeoutMs("darwin")).toBe(45_000);
    expect(getServeStartupTimeoutMs("linux")).toBe(45_000);
  });

  it("bounds each readiness request so probes cannot hang indefinitely", () => {
    expect(SERVE_READY_PROBE_TIMEOUT_MS).toBe(2_000);
  });
});
