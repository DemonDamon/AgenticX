import { afterEach, describe, expect, it, vi } from "vitest";
import type { NextConfig } from "next";

vi.mock("next-intl/plugin", () => ({
  default: () => (config: NextConfig) => config,
}));

import config from "./next.config";

const SECURITY_HEADER_RULE = {
  source: "/:path*",
  headers: [
    { key: "Content-Security-Policy", value: "frame-ancestors 'self'; object-src 'none'; base-uri 'self'" },
    { key: "X-Frame-Options", value: "SAMEORIGIN" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  ],
};

afterEach(() => vi.unstubAllEnvs());

describe("Portal security headers", () => {
  it("returns one catch-all rule with the four baseline headers", async () => {
    const rules = await config.headers?.();
    expect(rules).toEqual([SECURITY_HEADER_RULE]);
  });

  it.each(["production", "development", "test"])("does not derive HSTS from NODE_ENV=%s", async (mode) => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("PORTAL_HSTS_MAX_AGE", "31536000");
    await expect(config.headers?.()).resolves.toEqual([SECURITY_HEADER_RULE]);
  });
});
