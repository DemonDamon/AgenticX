import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "./secret-cipher";

export const DEFAULT_OIDC_STATE_COOKIE = "agenticx_oidc_state";

export type OidcStatePayload = {
  providerId: string;
  state: string;
  nonce: string;
  codeVerifier: string;
  returnTo?: string;
  expiresAt: number;
};

export function randomStateToken(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function encodeSignedState(payload: OidcStatePayload, secret: string): string {
  return encryptSecret(JSON.stringify(payload), secret);
}

export function decodeSignedState(raw: string, secret: string): OidcStatePayload {
  let decodedRaw = "";
  try {
    decodedRaw = decryptSecret(raw, secret);
  } catch {
    throw new Error("oidc.invalid_state_cookie");
  }

  const decoded = JSON.parse(decodedRaw) as OidcStatePayload;
  if (!decoded || typeof decoded !== "object") {
    throw new Error("oidc.invalid_state_payload");
  }
  if (decoded.expiresAt <= Date.now()) {
    throw new Error("oidc.state_expired");
  }
  return decoded;
}

export function buildStateCookieValue(
  payload: Omit<OidcStatePayload, "state" | "nonce" | "codeVerifier" | "expiresAt"> & {
    state?: string;
    nonce?: string;
    codeVerifier?: string;
    ttlMs?: number;
  },
  secret: string
): { cookieValue: string; state: OidcStatePayload } {
  const nextState: OidcStatePayload = {
    providerId: payload.providerId,
    returnTo: payload.returnTo,
    state: payload.state ?? randomStateToken(),
    nonce: payload.nonce ?? randomStateToken(),
    codeVerifier: payload.codeVerifier ?? randomStateToken(32),
    expiresAt: Date.now() + (payload.ttlMs ?? 10 * 60 * 1000),
  };
  return {
    cookieValue: encodeSignedState(nextState, secret),
    state: nextState,
  };
}

export function validateStateFromCookie(
  cookieValue: string | undefined | null,
  expectedState: string,
  secret: string
): OidcStatePayload {
  if (!cookieValue) {
    throw new Error("oidc.state_cookie_missing");
  }
  const decoded = decodeSignedState(cookieValue, secret);
  if (decoded.state !== expectedState) {
    throw new Error("oidc.invalid_state");
  }
  return decoded;
}
