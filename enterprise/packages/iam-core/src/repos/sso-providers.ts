import { ssoProviders } from "@agenticx/db-schema";
import { and, desc, eq } from "drizzle-orm";
import { ulid } from "ulid";
import { getIamDb } from "../db";
import { insertAuditEvent } from "./audit";

export type SsoProviderDto = {
  id: string;
  tenantId: string;
  providerId: string;
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecretEncrypted: string | null;
  redirectUri: string;
  scopes: string[];
  claimMapping: Record<string, unknown>;
  defaultRoleCodes: string[];
  enabled: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

function toDto(row: typeof ssoProviders.$inferSelect): SsoProviderDto {
  return {
    id: row.id,
    tenantId: row.tenantId,
    providerId: row.providerId,
    displayName: row.displayName,
    issuer: row.issuer,
    clientId: row.clientId,
    clientSecretEncrypted: row.clientSecretEncrypted ?? null,
    redirectUri: row.redirectUri,
    scopes: (row.scopes as string[]) ?? ["openid", "profile", "email"],
    claimMapping: (row.claimMapping as Record<string, unknown>) ?? {},
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

export async function createSsoProvider(input: {
  tenantId: string;
  actorUserId?: string | null;
  providerId: string;
  displayName: string;
  issuer: string;
  clientId: string;
  clientSecretEncrypted?: string | null;
  redirectUri: string;
  scopes: string[];
  claimMapping: Record<string, unknown>;
  defaultRoleCodes: string[];
  enabled?: boolean;
}): Promise<SsoProviderDto> {
  const db = getIamDb();
  const now = new Date();
  const id = ulid();
  await db.insert(ssoProviders).values({
    id,
    tenantId: input.tenantId,
    providerId: input.providerId,
    displayName: input.displayName,
    issuer: input.issuer,
    clientId: input.clientId,
    clientSecretEncrypted: input.clientSecretEncrypted ?? null,
    redirectUri: input.redirectUri,
    scopes: input.scopes,
    claimMapping: input.claimMapping,
    defaultRoleCodes: input.defaultRoleCodes,
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
    detail: { providerId: input.providerId, enabled: input.enabled ?? false },
  });

  const created = await getSsoProviderByProviderId(input.tenantId, input.providerId);
  if (!created) throw new Error("sso.provider_create_failed");
  return created;
}

export async function updateSsoProvider(
  tenantId: string,
  id: string,
  patch: Partial<{
    displayName: string;
    issuer: string;
    clientId: string;
    clientSecretEncrypted: string | null;
    redirectUri: string;
    scopes: string[];
    claimMapping: Record<string, unknown>;
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
      ...(patch.issuer !== undefined ? { issuer: patch.issuer } : {}),
      ...(patch.clientId !== undefined ? { clientId: patch.clientId } : {}),
      ...(patch.clientSecretEncrypted !== undefined ? { clientSecretEncrypted: patch.clientSecretEncrypted } : {}),
      ...(patch.redirectUri !== undefined ? { redirectUri: patch.redirectUri } : {}),
      ...(patch.scopes !== undefined ? { scopes: patch.scopes } : {}),
      ...(patch.claimMapping !== undefined ? { claimMapping: patch.claimMapping } : {}),
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
          issuer: existing.issuer,
          clientId: existing.clientId,
          displayName: existing.displayName,
          enabled: existing.enabled,
        }
      : { providerId: null, missing: true },
  });
  return existing;
}
