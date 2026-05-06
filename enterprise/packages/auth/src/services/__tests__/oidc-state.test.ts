import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildStateCookieValue,
  decodeSignedState,
  encodeSignedState,
  validateStateFromCookie,
  type OidcStatePayload,
} from "../oidc-state";

const SECRET = randomBytes(32).toString("hex");
const OTHER_SECRET = randomBytes(32).toString("hex");

describe("oidc-state", () => {
  it("rejects missing state cookie with oidc.state_cookie_missing", () => {
    expect(() => validateStateFromCookie(undefined, "any", SECRET)).toThrowError(
      "oidc.state_cookie_missing"
    );
    expect(() => validateStateFromCookie(null, "any", SECRET)).toThrowError(
      "oidc.state_cookie_missing"
    );
    expect(() => validateStateFromCookie("", "any", SECRET)).toThrowError(
      "oidc.state_cookie_missing"
    );
  });

  it("rejects cookie encrypted with another secret as oidc.invalid_state_cookie", () => {
    const { cookieValue, state } = buildStateCookieValue(
      { providerId: "default", returnTo: "/workspace", ttlMs: 5_000 },
      SECRET
    );
    expect(() => validateStateFromCookie(cookieValue, state.state, OTHER_SECRET)).toThrowError(
      "oidc.invalid_state_cookie"
    );
  });

  it("rejects garbage cookie value as oidc.invalid_state_cookie", () => {
    expect(() => validateStateFromCookie("not-a-valid-cookie", "any", SECRET)).toThrowError(
      "oidc.invalid_state_cookie"
    );
  });

  it("rejects expired state with oidc.state_expired", () => {
    const expiredPayload: OidcStatePayload = {
      providerId: "default",
      state: "state-x",
      nonce: "nonce-x",
      codeVerifier: "verifier-x",
      returnTo: "/workspace",
      expiresAt: Date.now() - 1_000,
    };
    const cookie = encodeSignedState(expiredPayload, SECRET);
    expect(() => decodeSignedState(cookie, SECRET)).toThrowError("oidc.state_expired");
  });

  it("never leaks codeVerifier or returnTo into the cookie value", () => {
    const { cookieValue, state } = buildStateCookieValue(
      { providerId: "default", returnTo: "/workspace/secret-page", ttlMs: 5_000 },
      SECRET
    );
    expect(cookieValue).not.toContain(state.codeVerifier);
    expect(cookieValue).not.toContain(state.nonce);
    expect(cookieValue).not.toContain("/workspace/secret-page");
    expect(cookieValue).not.toContain("default");
  });
});
