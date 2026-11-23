export type ClaimMapping = {
  email?: string;
  /** Verification claim for the mapped email; custom email paths require an explicit mapping. */
  emailVerified?: string;
  name?: string;
  externalId?: string;
  dept?: string;
  roles?: string;
};

export type OidcMappedUser = {
  email: string;
  emailVerified: boolean | null;
  displayName: string;
  externalId: string | null;
  deptHint: string | null;
  roleCodeHints: string[];
};

export class OidcClaimError extends Error {
  public constructor(
    public readonly code: string,
    message?: string
  ) {
    super(message ?? code);
    this.name = "OidcClaimError";
  }
}

export type OidcClaimDefaults = {
  email?: string;
  displayName?: string;
};

function getByPath(source: Record<string, unknown>, path: string): unknown {
  if (!path) return undefined;
  if (Object.prototype.hasOwnProperty.call(source, path)) return source[path];
  if (!path.includes(".")) return source[path];

  const parts = path.split(".");
  let cursor: unknown = source;
  for (const part of parts) {
    if (!cursor || typeof cursor !== "object") return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function normalizeRoleHints(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => `${item}`.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value
      .split(/[,\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

/** Stable identity always comes from the verified ID token, never a configurable business claim. */
export function resolveOidcIdentitySubject(claims: Record<string, unknown>): string {
  const subject = claims.sub;
  if (typeof subject !== "string" || !subject || subject !== subject.trim() || subject.length > 255) {
    throw new OidcClaimError("oidc.invalid_subject");
  }
  return subject;
}

function verifiedEmail(claims: Record<string, unknown>, mapping: ClaimMapping): boolean | null {
  const path = mapping.emailVerified?.trim() || ((mapping.email ?? "email") === "email" ? "email_verified" : "");
  if (!path) return null;
  const value = getByPath(claims, path);
  if (typeof value === "boolean") return value;
  // A number or generic truthy value never establishes email ownership.
  if (typeof value === "string" && /^(true|false)$/i.test(value.trim())) {
    return value.trim().toLowerCase() === "true";
  }
  return null;
}

export function mapClaimsToAuthUser(
  claims: Record<string, unknown>,
  mapping: ClaimMapping = {},
  defaults: OidcClaimDefaults = {}
): OidcMappedUser {
  const emailValue = getByPath(claims, mapping.email ?? "email");
  if (emailValue != null && typeof emailValue !== "string") {
    throw new OidcClaimError("oidc.claim.email_missing", "Email claim must be a string.");
  }
  const email = `${emailValue ?? defaults.email ?? ""}`.trim().toLowerCase();
  if (!email) {
    throw new OidcClaimError("oidc.claim.email_missing");
  }

  const nameValue = getByPath(claims, mapping.name ?? "name");
  const displayName = `${nameValue ?? defaults.displayName ?? email}`.trim() || email;

  const externalIdValue = getByPath(claims, mapping.externalId ?? "sub");
  const externalId = externalIdValue == null ? null : `${externalIdValue}`.trim() || null;

  const deptValue = getByPath(claims, mapping.dept ?? "department");
  const deptHint = deptValue == null ? null : `${deptValue}`.trim() || null;

  const rolesValue = getByPath(claims, mapping.roles ?? "roles");
  const roleCodeHints = normalizeRoleHints(rolesValue);

  return {
    email,
    emailVerified: typeof emailValue === "string" ? verifiedEmail(claims, mapping) : null,
    displayName,
    externalId,
    deptHint,
    roleCodeHints,
  };
}
