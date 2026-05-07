import type { SsoExternalIdentity } from "./sso-protocol-handler";

export type SamlAttributeMapping = {
  email: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  dept?: string;
  roles?: string;
  externalId?: string;
};

export type SamlProfileLike = {
  nameID?: string | null;
  nameIDFormat?: string | null;
  attributes?: Record<string, unknown>;
  [key: string]: unknown;
};

export class SamlAttributeError extends Error {
  public readonly code: string;
  public constructor(code: string, message?: string) {
    super(message ?? code);
    this.name = "SamlAttributeError";
    this.code = code;
  }
}

function readAttribute(attributes: Record<string, unknown> | undefined, key: string | undefined): unknown {
  if (!key) return undefined;
  if (!attributes) return undefined;
  if (Object.prototype.hasOwnProperty.call(attributes, key)) {
    return attributes[key];
  }
  // case-insensitive friendly read for IdP-side variations
  const lower = key.toLowerCase();
  for (const k of Object.keys(attributes)) {
    if (k.toLowerCase() === lower) return attributes[k];
  }
  return undefined;
}

function firstString(value: unknown): string | undefined {
  if (Array.isArray(value)) {
    for (const v of value) {
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return undefined;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (value == null) return undefined;
  const s = `${value}`.trim();
  return s || undefined;
}

function normalizeRoles(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .map((item) => `${item}`.trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(/[,;\s]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * 将 SAML 库返回的 profile + attributeMapping 归一化为 SsoExternalIdentity。
 * 严格要求至少能取到非空 email；缺失时抛 saml.attribute_email_missing。
 */
export function mapSamlProfileToIdentity(
  profile: SamlProfileLike,
  mapping: SamlAttributeMapping
): SsoExternalIdentity {
  const attributes = (profile.attributes as Record<string, unknown> | undefined) ?? {};

  const emailRaw = readAttribute(attributes, mapping.email) ?? readAttribute(attributes, "email");
  const email = firstString(emailRaw)?.toLowerCase() ?? "";
  if (!email) {
    throw new SamlAttributeError("saml.attribute_email_missing");
  }

  let displayName = firstString(readAttribute(attributes, mapping.displayName));
  if (!displayName) {
    const firstName = firstString(readAttribute(attributes, mapping.firstName));
    const lastName = firstString(readAttribute(attributes, mapping.lastName));
    if (firstName || lastName) {
      displayName = [firstName, lastName].filter(Boolean).join(" ").trim() || undefined;
    }
  }
  if (!displayName) displayName = email;

  const deptHint = firstString(readAttribute(attributes, mapping.dept)) ?? null;
  const roleCodeHints = normalizeRoles(readAttribute(attributes, mapping.roles));
  const externalId =
    firstString(readAttribute(attributes, mapping.externalId)) ?? firstString(profile.nameID) ?? "";

  return {
    externalSubject: externalId,
    email,
    displayName,
    deptHint: deptHint ?? null,
    roleCodeHints,
    rawAttributes: attributes,
  };
}
