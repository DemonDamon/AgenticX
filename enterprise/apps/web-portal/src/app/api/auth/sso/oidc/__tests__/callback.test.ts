import { buildStateCookieValue, validateStateFromCookie } from "@agenticx/auth";
import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

describe("OIDC callback state validation", () => {
  const stateSecret = randomBytes(32).toString("hex");

  it("rejects mismatched state", () => {
    const { cookieValue } = buildStateCookieValue(
      { providerId: "default", returnTo: "/workspace", ttlMs: 10_000 },
      stateSecret
    );

    expect(() =>
      validateStateFromCookie(cookieValue, "invalid-state", stateSecret)
    ).toThrowError("oidc.invalid_state");
  });
});
