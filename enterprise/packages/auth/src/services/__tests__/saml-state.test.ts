import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildSamlStateCookieValue,
  decodeSignedSamlState,
  validateSamlStateFromCookie,
} from "../saml-state";

describe("saml-state", () => {
  const secret = randomBytes(32).toString("hex");

  it("encodes and decodes payload, hides providerId from raw cookie", () => {
    const { cookieValue, state } = buildSamlStateCookieValue(
      { providerId: "default", returnTo: "/workspace", ttlMs: 5_000 },
      secret
    );
    expect(cookieValue).not.toContain("default");
    expect(cookieValue).not.toContain("/workspace");
    expect(cookieValue).not.toContain(state.relayState);
    const decoded = decodeSignedSamlState(cookieValue, secret);
    expect(decoded.providerId).toBe("default");
    expect(decoded.returnTo).toBe("/workspace");
    expect(decoded.relayState).toBe(state.relayState);
  });

  it("validateSamlStateFromCookie throws saml.relay_state_invalid on mismatch", () => {
    const { cookieValue, state } = buildSamlStateCookieValue({ providerId: "p1" }, secret);
    expect(() => validateSamlStateFromCookie(cookieValue, "wrong", secret)).toThrowError(
      "saml.relay_state_invalid"
    );
    expect(validateSamlStateFromCookie(cookieValue, state.relayState, secret).providerId).toBe("p1");
  });

  it("validateSamlStateFromCookie throws saml.relay_state_invalid when cookie missing", () => {
    expect(() => validateSamlStateFromCookie(undefined, "x", secret)).toThrowError(
      "saml.relay_state_invalid"
    );
  });

  it("decodeSignedSamlState throws saml.relay_state_expired when expired", () => {
    const { cookieValue } = buildSamlStateCookieValue({ providerId: "p2", ttlMs: -1_000 }, secret);
    expect(() => decodeSignedSamlState(cookieValue, secret)).toThrowError("saml.relay_state_expired");
  });

  it("decodeSignedSamlState throws saml.relay_state_invalid on tampered cipher", () => {
    expect(() => decodeSignedSamlState("garbage", secret)).toThrowError("saml.relay_state_invalid");
  });
});
