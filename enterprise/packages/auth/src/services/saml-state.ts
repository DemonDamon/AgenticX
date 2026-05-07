import { randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "./secret-cipher";

export const DEFAULT_SAML_PORTAL_STATE_COOKIE = "agenticx_saml_state_portal";
export const DEFAULT_SAML_ADMIN_STATE_COOKIE = "agenticx_saml_state_admin";

export type SamlStatePayload = {
  providerId: string;
  relayState: string;
  requestId?: string | null;
  returnTo?: string;
  expiresAt: number;
};

export function randomRelayState(bytes = 24): string {
  return randomBytes(bytes).toString("base64url");
}

export function encodeSignedSamlState(payload: SamlStatePayload, secret: string): string {
  return encryptSecret(JSON.stringify(payload), secret);
}

export function decodeSignedSamlState(raw: string, secret: string): SamlStatePayload {
  let decodedRaw = "";
  try {
    decodedRaw = decryptSecret(raw, secret);
  } catch {
    throw new Error("saml.relay_state_invalid");
  }
  let decoded: SamlStatePayload;
  try {
    decoded = JSON.parse(decodedRaw) as SamlStatePayload;
  } catch {
    throw new Error("saml.relay_state_invalid");
  }
  if (!decoded || typeof decoded !== "object") {
    throw new Error("saml.relay_state_invalid");
  }
  if (typeof decoded.expiresAt !== "number" || decoded.expiresAt <= Date.now()) {
    throw new Error("saml.relay_state_expired");
  }
  return decoded;
}

export function buildSamlStateCookieValue(
  payload: Omit<SamlStatePayload, "relayState" | "expiresAt"> & {
    relayState?: string;
    ttlMs?: number;
  },
  secret: string
): { cookieValue: string; state: SamlStatePayload } {
  const next: SamlStatePayload = {
    providerId: payload.providerId,
    relayState: payload.relayState ?? randomRelayState(),
    requestId: payload.requestId ?? null,
    returnTo: payload.returnTo,
    expiresAt: Date.now() + (payload.ttlMs ?? 10 * 60 * 1000),
  };
  return {
    cookieValue: encodeSignedSamlState(next, secret),
    state: next,
  };
}

export function validateSamlStateFromCookie(
  cookieValue: string | undefined | null,
  expectedRelayState: string,
  secret: string
): SamlStatePayload {
  if (!cookieValue) {
    throw new Error("saml.relay_state_invalid");
  }
  const decoded = decodeSignedSamlState(cookieValue, secret);
  if (decoded.relayState !== expectedRelayState) {
    throw new Error("saml.relay_state_invalid");
  }
  return decoded;
}
