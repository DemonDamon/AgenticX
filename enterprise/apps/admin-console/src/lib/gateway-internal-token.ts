import { readFileSync } from "node:fs";

let cached: string | undefined;

/** Resolve gateway internal bearer token from env or GATEWAY_INTERNAL_TOKEN_FILE. */
export function getGatewayInternalToken(): string {
  if (cached !== undefined) return cached;

  const direct = process.env.GATEWAY_INTERNAL_TOKEN?.trim();
  if (direct) {
    cached = direct;
    return direct;
  }

  const file = process.env.GATEWAY_INTERNAL_TOKEN_FILE?.trim();
  if (file) {
    try {
      const fromFile = readFileSync(file, "utf-8").trim();
      if (fromFile) {
        cached = fromFile;
        return fromFile;
      }
    } catch {
      // fall through
    }
  }

  cached = "";
  return "";
}

export function requireGatewayInternalToken(): string {
  const token = getGatewayInternalToken();
  if (!token) throw new Error("GATEWAY_INTERNAL_TOKEN is required");
  return token;
}
