import { afterEach, describe, expect, it, vi } from "vitest";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { config, middleware } from "./middleware";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("portal HSTS middleware", () => {
  it("sets Strict-Transport-Security when PORTAL_HSTS_MAX_AGE is set", () => {
    vi.stubEnv("PORTAL_HSTS_MAX_AGE", "31536000");
    vi.stubEnv("PORTAL_HSTS_DEFAULT_MAX_AGE", "");
    expect(middleware().headers.get("strict-transport-security")).toBe("max-age=31536000");
  });

  it("omits Strict-Transport-Security when HSTS env is unset", () => {
    vi.stubEnv("PORTAL_HSTS_MAX_AGE", "");
    vi.stubEnv("PORTAL_HSTS_DEFAULT_MAX_AGE", "");
    expect(middleware().headers.get("strict-transport-security")).toBeNull();
  });

  it("runs on the Node.js runtime", () => {
    expect(config.runtime).toBe("nodejs");
  });

  it.each([
    ["/_next/static/x.js", false],
    ["/_next/image", false],
    ["/favicon.ico", false],
    ["/workspace", true],
    ["/api/chat/sessions", true],
  ] as const)("matcher %s -> %s", (url, expected) => {
    expect(unstable_doesMiddlewareMatch({ config, url })).toBe(expected);
  });
});
