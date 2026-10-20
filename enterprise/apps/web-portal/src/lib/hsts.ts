/**
 * Opt-in HSTS, read at request time by middleware. Never inferred from NODE_ENV.
 *
 * `PORTAL_HSTS_MAX_AGE` is a non-negative integer number of seconds (surrounding
 * whitespace is ignored). `0` is valid and sends `max-age=0`. When that variable
 * is unset or `""`, `PORTAL_HSTS_DEFAULT_MAX_AGE` is used the same way. If both
 * are empty, no header is sent.
 *
 * Any other value is ignored: this returns null and `console.warn` names the
 * variable only (the value is not echoed). The same invalid value warns at most
 * once per process. The header is `max-age=<n>` only.
 */

const HSTS_ENV = "PORTAL_HSTS_MAX_AGE";
const HSTS_DEFAULT_ENV = "PORTAL_HSTS_DEFAULT_MAX_AGE";

const warned = new Set<string>();

function warnIgnored(envName: string, raw: string): void {
  const key = `${envName}:${raw}`;
  if (warned.has(key)) return;
  warned.add(key);
  console.warn(
    `[security-headers] ${envName} must be a non-negative integer number of seconds; it is ignored`,
  );
}

type AgeRead = number | "empty" | "invalid";

function readAge(raw: string | undefined, envName: string): AgeRead {
  if (raw == null || raw === "") return "empty";
  const value = raw.trim();
  if (!/^\d+$/.test(value)) {
    warnIgnored(envName, raw);
    return "invalid";
  }
  const seconds = Number(value);
  if (!Number.isSafeInteger(seconds)) {
    warnIgnored(envName, raw);
    return "invalid";
  }
  return seconds;
}

export function resolveHstsHeader(
  env: Record<string, string | undefined> = process.env,
): string | null {
  const primary = readAge(env.PORTAL_HSTS_MAX_AGE, HSTS_ENV);
  if (primary === "invalid") return null;
  const seconds = primary === "empty" ? readAge(env.PORTAL_HSTS_DEFAULT_MAX_AGE, HSTS_DEFAULT_ENV) : primary;
  if (typeof seconds !== "number") return null;
  return `max-age=${seconds}`;
}
