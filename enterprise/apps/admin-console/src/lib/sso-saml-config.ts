import "server-only";
import type { SsoProviderSamlConfig } from "@agenticx/iam-core";
import { NextResponse } from "next/server";
import { assertSafeIssuerUrl, assertSafeRedirectUri } from "./sso-url-guard";

const ALLOWED_NAME_ID_FORMATS = new Set([
  "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
  "urn:oasis:names:tc:SAML:2.0:nameid-format:persistent",
  "urn:oasis:names:tc:SAML:2.0:nameid-format:transient",
  "urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified",
]);

export class SamlConfigPayloadError extends Error {
  public readonly field: string;
  public constructor(field: string, message: string) {
    super(message);
    this.name = "SamlConfigPayloadError";
    this.field = field;
  }
}

function ensureNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new SamlConfigPayloadError(field, `${field} 不能为空`);
  }
  return value.trim();
}

function ensureUrl(value: unknown, field: string): string {
  const trimmed = ensureNonEmptyString(value, field);
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new SamlConfigPayloadError(field, `${field} 必须是合法 URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SamlConfigPayloadError(field, `${field} 仅允许 http/https`);
  }
  return trimmed;
}

function ensureCertPemList(value: unknown, field: string): string[] {
  const list = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/-----END CERTIFICATE-----/).map((part) => (part.trim() ? `${part.trim()}\n-----END CERTIFICATE-----` : ""))
      : [];
  const cleaned = list
    .map((entry) => `${entry}`.trim())
    .filter((entry) => entry.length > 0);
  if (cleaned.length === 0) {
    throw new SamlConfigPayloadError(field, `${field} 至少需要一份 IdP 证书 PEM`);
  }
  for (const pem of cleaned) {
    if (!pem.includes("BEGIN CERTIFICATE")) {
      throw new SamlConfigPayloadError(field, `${field} 包含的 PEM 缺少 BEGIN CERTIFICATE 块`);
    }
  }
  return cleaned;
}

function normalizeAttributeMapping(value: unknown): SsoProviderSamlConfig["attributeMapping"] {
  const raw = (value ?? {}) as Record<string, unknown>;
  const email = typeof raw.email === "string" && raw.email.trim() ? raw.email.trim() : "email";
  const optional = (key: string) => {
    const v = raw[key];
    return typeof v === "string" && v.trim() ? v.trim() : undefined;
  };
  return {
    email,
    displayName: optional("displayName"),
    firstName: optional("firstName"),
    lastName: optional("lastName"),
    dept: optional("dept"),
    roles: optional("roles"),
    externalId: optional("externalId"),
  };
}

export function parseSamlConfigPayload(value: unknown): SsoProviderSamlConfig {
  if (!value || typeof value !== "object") {
    throw new SamlConfigPayloadError("samlConfig", "samlConfig 缺失");
  }
  const raw = value as Record<string, unknown>;
  const idpEntityId = ensureNonEmptyString(raw.idpEntityId, "samlConfig.idpEntityId");
  const idpSsoUrl = ensureUrl(raw.idpSsoUrl, "samlConfig.idpSsoUrl");
  const idpSloUrl =
    raw.idpSloUrl === undefined || raw.idpSloUrl === null || raw.idpSloUrl === ""
      ? null
      : ensureUrl(raw.idpSloUrl, "samlConfig.idpSloUrl");
  const idpCertPemList = ensureCertPemList(raw.idpCertPemList, "samlConfig.idpCertPemList");
  const spEntityId = ensureNonEmptyString(raw.spEntityId, "samlConfig.spEntityId");
  const acsUrl = ensureUrl(raw.acsUrl, "samlConfig.acsUrl");
  let nameIdFormat: SsoProviderSamlConfig["nameIdFormat"] = null;
  if (typeof raw.nameIdFormat === "string" && raw.nameIdFormat.trim()) {
    if (!ALLOWED_NAME_ID_FORMATS.has(raw.nameIdFormat.trim())) {
      throw new SamlConfigPayloadError("samlConfig.nameIdFormat", `不支持的 nameIdFormat: ${raw.nameIdFormat}`);
    }
    nameIdFormat = raw.nameIdFormat.trim() as SsoProviderSamlConfig["nameIdFormat"];
  }
  const wantAssertionsSigned = raw.wantAssertionsSigned !== false;
  const wantResponseSigned = raw.wantResponseSigned === true;
  const skewRaw = raw.clockSkewSeconds;
  const clockSkewSeconds = typeof skewRaw === "number" && Number.isFinite(skewRaw) ? Math.max(0, skewRaw) : 60;
  const attributeMapping = normalizeAttributeMapping(raw.attributeMapping);
  return {
    idpEntityId,
    idpSsoUrl,
    idpSloUrl,
    idpCertPemList,
    spEntityId,
    acsUrl,
    nameIdFormat,
    wantAssertionsSigned,
    wantResponseSigned,
    clockSkewSeconds,
    attributeMapping,
  };
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isNonProductionEnv(): boolean {
  return (process.env.NODE_ENV ?? "development") !== "production";
}

function isDevMockIdpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:") return false;
    const host = parsed.hostname.trim().toLowerCase();
    return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
  } catch {
    return false;
  }
}

async function assertSafeSamlIdpUrl(value: string): Promise<void> {
  if (isNonProductionEnv() && isDevMockIdpUrl(value)) {
    return;
  }
  await assertSafeIssuerUrl(value);
}

export async function assertSafeSamlConfigUrls(config: SsoProviderSamlConfig): Promise<void> {
  await assertSafeSamlIdpUrl(config.idpSsoUrl);
  await assertSafeRedirectUri(config.acsUrl, { issuerUrl: config.idpSsoUrl });
  if (isHttpUrl(config.idpEntityId)) {
    await assertSafeSamlIdpUrl(config.idpEntityId);
  }
}

export function samlConfigErrorResponse(error: unknown): NextResponse {
  if (error instanceof SamlConfigPayloadError) {
    return NextResponse.json({ code: "40000", message: `SAML 配置不合法: ${error.message}`, field: error.field }, { status: 400 });
  }
  const message = error instanceof Error ? error.message : "invalid_saml_config";
  return NextResponse.json({ code: "40000", message: `SAML 配置不合法: ${message}` }, { status: 400 });
}
