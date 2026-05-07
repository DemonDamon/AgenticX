import {
  ssoProviders,
  type SsoProviderProtocol,
  type SsoProviderSamlConfig,
} from "@agenticx/db-schema";

export type { SsoProviderProtocol, SsoProviderSamlConfig };
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getIamDb } from "../db";
import { insertAuditEvent } from "./audit";

export type SsoProviderDto = {
  id: string;
  tenantId: string;
  providerId: string;
  displayName: string;
  protocol: SsoProviderProtocol;
  issuer: string | null;
  clientId: string | null;
  clientSecretEncrypted: string | null;
  redirectUri: string | null;
  scopes: string[];
  claimMapping: Record<string, unknown>;
  samlConfig: SsoProviderSamlConfig | null;
  defaultRoleCodes: string[];
  enabled: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function normalizeProtocol(value: unknown): SsoProviderProtocol {
  return value === "saml" ? "saml" : "oidc";
}

function toDto(row: typeof ssoProviders.$inferSelect): SsoProviderDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerId: row.providerId,
    displayName: row.displayName,
    protocol: normalizeProtocol(row.protocol),
    issuer: row.issuer ?? null,
    clientId: row.clientId ?? null,
    clientSecretEncrypted: row.clientSecretEncrypted ?? null,
    redirectUri: row.redirectUri ?? null,
    scopes: (row.scopes as string[]) ?? ["openid", "profile", "email"],
    claimMapping: (row.claimMapping as Record<string, unknown>) ?? {},
    samlConfig: (row.samlConfig as SsoProviderSamlConfig | null) ?? null,
    defaultRoleCodes: (row.defaultRoleCodes as string[]) ?? ["member"],
    enabled: row.enabled,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export async function listSsoProviders(tenantId: string): Promise<SsoProviderDto[]> {
  const db = getIamDb();
  const rows = await db
    .select()
    .from(ssoProviders)
    .where(eq(ssoProviders.tenantId, tenantId))
    .orderBy(desc(ssoProviders.updatedAt));
  return rows.map(toDto);
}

export async function getSsoProviderByProviderId(
  tenantId: string,
  providerId: string
): Promise<SsoProviderDto | null> {
  const db = getIamDb();
  const rows = await db
    .select()
    .from(ssoProviders)
    .where(and(eq(ssoProviders.tenantId, tenantId), eq(ssoProviders.providerId, providerId)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function getSsoProviderById(tenantId: string, id: string): Promise<SsoProviderDto | null> {
  const db = getIamDb();
  const rows = await db
    .select()
    .from(ssoProviders)
    .where(and(eq(ssoProviders.tenantId, tenantId), eq(ssoProviders.id, id)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

/**
 * 双协议安全选择器：仅返回 enabled 且 protocol 匹配的 provider。
 * 老的 getSsoProviderByProviderId 在 OIDC 链路保留作为默认入口（隐式回退 oidc）。
 */
export async function findEnabledByProviderIdAndProtocol(
  tenantId: string,
  providerId: string,
  protocol: SsoProviderProtocol
): Promise<SsoProviderDto | null> {
  const provider = await getSsoProviderByProviderId(tenantId, providerId);
  if (!provider) return null;
  if (!provider.enabled) return null;
  if (provider.protocol !== protocol) return null;
  return provider;
}

export async function createSsoProvider(input: {
  tenantId: string;
  actorUserId?: string | null;
  providerId: string;
  displayName: string;
  protocol?: SsoProviderProtocol;
  issuer?: string | null;
  clientId?: string | null;
  clientSecretEncrypted?: string | null;
  redirectUri?: string | null;
  scopes?: string[];
  claimMapping?: Record<string, unknown>;
  samlConfig?: SsoProviderSamlConfig | null;
  defaultRoleCodes?: string[];
  enabled?: boolean;
}): Promise<SsoProviderDto> {
  const db = getIamDb();
  const now = new Date();
  const id = ulid();
  const protocol = input.protocol ?? "oidc";
  if (protocol === "oidc") {
    if (!input.issuer || !input.clientId || !input.redirectUri) {
      throw new Error("sso.oidc_required_fields_missing");
    }
  } else {
    if (!input.samlConfig) {
      throw new Error("sso.saml_config_required");
    }
  }
  await db.insert(ssoProviders).values({
    id,
    tenantId: input.tenantId,
    providerId: input.providerId,
    displayName: input.displayName,
    protocol,
    issuer: protocol === "oidc" ? (input.issuer ?? null) : null,
    clientId: protocol === "oidc" ? (input.clientId ?? null) : null,
    clientSecretEncrypted: protocol === "oidc" ? (input.clientSecretEncrypted ?? null) : null,
    redirectUri: protocol === "oidc" ? (input.redirectUri ?? null) : null,
    scopes: input.scopes ?? ["openid", "profile", "email"],
    claimMapping: input.claimMapping ?? {},
    samlConfig: protocol === "saml" ? (input.samlConfig ?? null) : null,
    defaultRoleCodes: input.defaultRoleCodes ?? ["member"],
    enabled: input.enabled ?? false,
    createdBy: input.actorUserId ?? null,
    updatedBy: input.actorUserId ?? null,
    createdAt: now,
    updatedAt: now,
  });

  await insertAuditEvent({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId ?? null,
    eventType: "auth.sso.provider.create",
    targetKind: "sso_provider",
    targetId: id,
    detail: { providerId: input.providerId, protocol, enabled: input.enabled ?? false },
  });

  const created = await getSsoProviderByProviderId(input.tenantId, input.providerId);
  if (!created) throw new Error("sso.provider_create_failed");
  return created;
}

/**
 * SAML provider 创建语义糖；强制 protocol = 'saml'，参数与 SsoProviderSamlConfig 对齐。
 */
export async function createSamlProvider(input: {
  tenantId: string;
  actorUserId?: string | null;
  providerId: string;
  displayName: string;
  samlConfig: SsoProviderSamlConfig;
  defaultRoleCodes?: string[];
  enabled?: boolean;
  claimMapping?: Record<string, unknown>;
}): Promise<SsoProviderDto> {
  return createSsoProvider({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    providerId: input.providerId,
    displayName: input.displayName,
    protocol: "saml",
    samlConfig: input.samlConfig,
    defaultRoleCodes: input.defaultRoleCodes,
    enabled: input.enabled,
    claimMapping: input.claimMapping ?? {},
  });
}

export async function updateSsoProvider(
  tenantId: string,
  id: string,
  patch: Partial<{
    displayName: string;
    protocol: SsoProviderProtocol;
    issuer: string | null;
    clientId: string | null;
    clientSecretEncrypted: string | null;
    redirectUri: string | null;
    scopes: string[];
    claimMapping: Record<string, unknown>;
    samlConfig: SsoProviderSamlConfig | null;
    defaultRoleCodes: string[];
    enabled: boolean;
  }>,
  actorUserId?: string | null
): Promise<SsoProviderDto | null> {
  const db = getIamDb();
  await db
    .update(ssoProviders)
    .set({
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.protocol !== undefined ? { protocol: patch.protocol } : {}),
      ...(patch.issuer !== undefined ? { issuer: patch.issuer } : {}),
      ...(patch.clientId !== undefined ? { clientId: patch.clientId } : {}),
      ...(patch.clientSecretEncrypted !== undefined ? { clientSecretEncrypted: patch.clientSecretEncrypted } : {}),
      ...(patch.redirectUri !== undefined ? { redirectUri: patch.redirectUri } : {}),
      ...(patch.scopes !== undefined ? { scopes: patch.scopes } : {}),
      ...(patch.claimMapping !== undefined ? { claimMapping: patch.claimMapping } : {}),
      ...(patch.samlConfig !== undefined ? { samlConfig: patch.samlConfig } : {}),
      ...(patch.defaultRoleCodes !== undefined ? { defaultRoleCodes: patch.defaultRoleCodes } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      updatedBy: actorUserId ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(ssoProviders.tenantId, tenantId), eq(ssoProviders.id, id)));

  await insertAuditEvent({
    tenantId,
    actorUserId: actorUserId ?? null,
    eventType: "auth.sso.provider.update",
    targetKind: "sso_provider",
    targetId: id,
    detail: patch as Record<string, unknown>,
  });

  const rows = await db
    .select()
    .from(ssoProviders)
    .where(and(eq(ssoProviders.tenantId, tenantId), eq(ssoProviders.id, id)))
    .limit(1);
  return rows[0] ? toDto(rows[0]) : null;
}

export async function deleteSsoProvider(
  tenantId: string,
  id: string,
  actorUserId?: string | null
): Promise<SsoProviderDto | null> {
  const db = getIamDb();
  const existing = await getSsoProviderById(tenantId, id);
  await db.delete(ssoProviders).where(and(eq(ssoProviders.tenantId, tenantId), eq(ssoProviders.id, id)));
  await insertAuditEvent({
    tenantId,
    actorUserId: actorUserId ?? null,
    eventType: "auth.sso.provider.delete",
    targetKind: "sso_provider",
    targetId: id,
    detail: existing
      ? {
          providerId: existing.providerId,
          protocol: existing.protocol,
          issuer: existing.issuer,
          clientId: existing.clientId,
          displayName: existing.displayName,
          enabled: existing.enabled,
        }
      : { providerId: null, missing: true },
  });
  return existing;
}
