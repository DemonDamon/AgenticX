import {
  ssoProviders,
  type SsoProviderProtocol,
  type SsoProviderSamlConfig,
} from "@agenticx/db-schema/mysql";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";

import type { SsoProviderDto, SsoProviderPatch } from "../sso-providers";
import type { SsoProvidersRepository } from "../contracts";
import { insertMysqlAuditEvent } from "./audit";
import { getMysqlRepositoryDb } from "./db";

function stringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function toDto(row: typeof ssoProviders.$inferSelect): SsoProviderDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerId: row.providerId,
    displayName: row.displayName,
    protocol: row.protocol === "saml" ? "saml" : "oidc",
    issuer: row.issuer ?? null,
    clientId: row.clientId ?? null,
    clientSecretEncrypted: row.clientSecretEncrypted ?? null,
    redirectUri: row.redirectUri ?? null,
    scopes: stringArray(row.scopes, ["openid", "profile", "email"]),
    claimMapping: objectValue(row.claimMapping),
    samlConfig: row.samlConfig && typeof row.samlConfig === "object"
      ? row.samlConfig as SsoProviderSamlConfig
      : null,
    defaultRoleCodes: stringArray(row.defaultRoleCodes, ["member"]),
    enabled: row.enabled,
    createdBy: row.createdBy ?? null,
    updatedBy: row.updatedBy ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getById(tenantId: string, id: string): Promise<SsoProviderDto | null> {
  const db = await getMysqlRepositoryDb();
  const [row] = await db.select().from(ssoProviders)
    .where(and(eq(ssoProviders.tenantId, tenantId), eq(ssoProviders.id, id))).limit(1);
  return row ? toDto(row) : null;
}

export const mysqlSsoProvidersRepository: SsoProvidersRepository = {
  dialect: "mysql",
  async listSsoProviders(tenantId) {
    const db = await getMysqlRepositoryDb();
    const rows = await db.select().from(ssoProviders)
      .where(eq(ssoProviders.tenantId, tenantId)).orderBy(desc(ssoProviders.updatedAt));
    return rows.map(toDto);
  },
  async getSsoProviderByProviderId(tenantId, providerId) {
    const db = await getMysqlRepositoryDb();
    const [row] = await db.select().from(ssoProviders)
      .where(and(eq(ssoProviders.tenantId, tenantId), eq(ssoProviders.providerId, providerId))).limit(1);
    return row ? toDto(row) : null;
  },
  getSsoProviderById: getById,
  async createSsoProvider(input) {
    const protocol: SsoProviderProtocol = input.protocol ?? "oidc";
    if (protocol === "oidc" && (!input.issuer || !input.clientId || !input.redirectUri)) {
      throw new Error("sso.oidc_required_fields_missing");
    }
    if (protocol === "saml" && !input.samlConfig) throw new Error("sso.saml_config_required");
    const db = await getMysqlRepositoryDb();
    const id = ulid();
    const now = new Date();
    await db.insert(ssoProviders).values({
      id, tenantId: input.tenantId, providerId: input.providerId,
      displayName: input.displayName, protocol,
      issuer: protocol === "oidc" ? input.issuer ?? null : null,
      clientId: protocol === "oidc" ? input.clientId ?? null : null,
      clientSecretEncrypted: protocol === "oidc" ? input.clientSecretEncrypted ?? null : null,
      redirectUri: protocol === "oidc" ? input.redirectUri ?? null : null,
      scopes: input.scopes ?? ["openid", "profile", "email"],
      claimMapping: input.claimMapping ?? {},
      samlConfig: protocol === "saml" ? input.samlConfig ?? null : null,
      defaultRoleCodes: input.defaultRoleCodes ?? ["member"],
      enabled: input.enabled ?? false,
      createdBy: input.actorUserId ?? null, updatedBy: input.actorUserId ?? null,
      createdAt: now, updatedAt: now,
    });
    await insertMysqlAuditEvent({
      tenantId: input.tenantId, actorUserId: input.actorUserId ?? null,
      eventType: "auth.sso.provider.create", targetKind: "sso_provider", targetId: id,
      detail: { providerId: input.providerId, protocol, enabled: input.enabled ?? false },
    });
    const created = await getById(input.tenantId, id);
    if (!created) throw new Error("sso.provider_create_failed");
    return created;
  },
  async updateSsoProvider(tenantId, id, patch: SsoProviderPatch, actorUserId) {
    const db = await getMysqlRepositoryDb();
    await db.update(ssoProviders).set({
      ...patch,
      updatedBy: actorUserId ?? null,
      updatedAt: new Date(),
    }).where(and(eq(ssoProviders.tenantId, tenantId), eq(ssoProviders.id, id)));
    await insertMysqlAuditEvent({
      tenantId, actorUserId: actorUserId ?? null, eventType: "auth.sso.provider.update",
      targetKind: "sso_provider", targetId: id, detail: patch,
    });
    return getById(tenantId, id);
  },
  async deleteSsoProvider(tenantId, id, actorUserId) {
    const existing = await getById(tenantId, id);
    const db = await getMysqlRepositoryDb();
    await db.delete(ssoProviders)
      .where(and(eq(ssoProviders.tenantId, tenantId), eq(ssoProviders.id, id)));
    await insertMysqlAuditEvent({
      tenantId, actorUserId: actorUserId ?? null, eventType: "auth.sso.provider.delete",
      targetKind: "sso_provider", targetId: id,
      detail: existing ? { providerId: existing.providerId, protocol: existing.protocol } : { missing: true },
    });
    return existing;
  },
};
