import {
  enterpriseAgentVersions as pgVersions,
  enterpriseAgents as pgAgents,
  maCredentials as pgCredentials,
  maSessions as pgSessions,
  maVaults as pgVaults,
} from "@agenticx/db-schema";
import { and, asc, desc, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";
import { ulid } from "ulid";

import { resolveDatabaseConfig } from "../database/config";
import { getIamDb } from "../db";
import { openSecretPayload, sealSecretPayload, VaultDecryptError, type SealedSecret } from "../ma-vault-crypto";
import { insertAuditEvent, type AuditInsert } from "./audit";
import {
  assertCredentialSecrets,
  normalizeCredentialCreate,
  normalizeCredentialPatch,
  MaVaultValidationError,
  normalizeMcpServerUrlKeepingQuery,
  readNetworking,
  readRefreshPublic,
  validateVaultInput,
  type MaCredentialType,
  type MaIdentityKind,
  type MaNetworking,
} from "./ma-vault-validate";
import {
  mysqlArchiveVault,
  mysqlCountActiveCredentials,
  mysqlCredentialCounts,
  mysqlDeleteCredential,
  mysqlDeleteVault,
  mysqlFindCredential,
  mysqlFindVault,
  mysqlInsertCredential,
  mysqlInsertVault,
  mysqlListAgentManifests,
  mysqlListCredentials,
  mysqlListSessionReferences,
  mysqlListVaults,
  mysqlTouchResolved,
  mysqlUpdateCredential,
  mysqlUpdateVault,
  mysqlVaultStatuses,
  mysqlWriteRefreshed,
} from "./mysql/ma-vaults";

export type MaVaultStatus = "active" | "archived";
export type MaVault = {
  id: string;
  tenantId: string;
  displayName: string;
  description: string | null;
  metadata: Record<string, string>;
  status: MaVaultStatus;
  credentialCount: number;
  createdBy: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type MaCredential = {
  id: string;
  tenantId: string;
  vaultId: string;
  displayName: string | null;
  type: MaCredentialType;
  identityKind: MaIdentityKind;
  identityKey: string;
  publicConfig: Record<string, unknown>;
  secretFields: string[];
  hasSecret: boolean;
  status: "active" | "archived";
  expiresAt: string | null;
  lastRotatedAt: string | null;
  lastResolvedAt: string | null;
  createdBy: string | null;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
};
export type VaultReferences = {
  sessions: {
    active_count: number;
    recent: Array<{
      id: string;
      agent_id: string;
      status: string;
      created_by_user_id: string | null;
      created_at: string;
    }>;
  };
  agents: Array<{ id: string; display_name: string; latest_version: number; matched: string[] }>;
};
export type ResolveInput = {
  tenantId: string;
  sessionId: string;
  sessionUserId: string | null;
  vaultIds: string[];
};
export type ResolvedCredential =
  | {
      credential_id: string;
      vault_id: string;
      vault_index: number;
      type: "static_bearer";
      display_name: string | null;
      mcp_server_url: string;
      token: string;
    }
  | {
      credential_id: string;
      vault_id: string;
      vault_index: number;
      type: "mcp_oauth";
      display_name: string | null;
      mcp_server_url: string;
      access_token: string;
      expires_at: string | null;
      refresh_error?: "failed";
    }
  | {
      credential_id: string;
      vault_id: string;
      vault_index: number;
      type: "bearer";
      display_name: string | null;
      host: string;
      token: string;
    }
  | {
      credential_id: string;
      vault_id: string;
      vault_index: number;
      type: "environment_variable";
      display_name: string | null;
      secret_name: string;
      secret_value: string;
      networking: MaNetworking;
    };
export type ResolvedBundle = {
  session_id: string;
  resolved_at: string;
  credentials: ResolvedCredential[];
  skipped: Array<{ vault_id: string; reason: "not_found" | "archived" }>;
  auditDetail: Record<string, unknown>;
};
export type RefreshOutcome = {
  secrets: Record<string, string>;
  expiresAt: string | null;
  refreshed: boolean;
  failed: boolean;
  status: number;
};

export class MaVaultNotFoundError extends Error {
  constructor(message = "凭证库不存在") {
    super(message);
    this.name = "MaVaultNotFoundError";
  }
}
export class MaCredentialNotFoundError extends Error {
  constructor(message = "凭证不存在") {
    super(message);
    this.name = "MaCredentialNotFoundError";
  }
}
export class MaCredentialIdentityConflictError extends Error {
  constructor(message = "该凭证库中已存在相同匹配目标的有效凭证") {
    super(message);
    this.name = "MaCredentialIdentityConflictError";
  }
}
export class MaVaultCredentialLimitError extends Error {
  constructor(message = "单个凭证库最多 100 条有效凭证") {
    super(message);
    this.name = "MaVaultCredentialLimitError";
  }
}
export class MaVaultNotArchivedError extends Error {
  constructor(message = "请先归档凭证库再删除") {
    super(message);
    this.name = "MaVaultNotArchivedError";
  }
}
export class MaVaultArchivedError extends Error {
  constructor(message = "凭证库已归档，不能再修改") {
    super(message);
    this.name = "MaVaultArchivedError";
  }
}

export const MA_VAULT_CREDENTIAL_LIMIT = 100;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

type VaultDbRow = {
  id: string;
  tenantId: string;
  displayName: string;
  description: string | null;
  metadata: unknown;
  status: string;
  createdBy: string | null;
  archivedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};
type CredentialDbRow = {
  id: string;
  tenantId: string;
  vaultId: string;
  displayName: string | null;
  type: string;
  identityKind: string;
  identityKey: string;
  publicConfig: unknown;
  secretFields: unknown;
  secretCiphertext: string | null;
  wrappedDek: string | null;
  kekId: string | null;
  status: string;
  expiresAt: unknown;
  lastRotatedAt: unknown;
  lastResolvedAt: unknown;
  createdBy: string | null;
  archivedAt: unknown;
  createdAt: unknown;
  updatedAt: unknown;
};
type StoredCredential = MaCredential & {
  secretCiphertext: string | null;
  wrappedDek: string | null;
  kekId: string | null;
};
type ResolveDeps = {
  fetchImpl?: typeof fetch;
  now?: () => Date;
  findVault?: (tenantId: string, vaultId: string) => Promise<{ id: string; status: string } | null>;
  listActiveCredentials?: (tenantId: string, vaultId: string) => Promise<StoredCredential[]>;
  writeRefreshed?: (row: StoredCredential, sealed: SealedSecret, secretFields: string[], expiresAt: string | null, now: Date) => Promise<void>;
  touchResolved?: (tenantId: string, ids: string[], at: Date) => Promise<void>;
  insertAudit?: (input: AuditInsert) => Promise<void>;
  openPayload?: (sealed: SealedSecret) => Record<string, string>;
};

function isMysql(): boolean {
  return resolveDatabaseConfig().dialect === "mysql";
}

function iso(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? value : new Date(parsed).toISOString();
  }
  return value == null ? "" : String(value);
}

function nullableIso(value: unknown): string | null {
  if (value == null || value === "") return null;
  return iso(value);
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asMetadata(value: unknown): Record<string, string> {
  const parsed = parseJson(value);
  if (!isRecord(parsed)) return {};
  const out: Record<string, string> = {};
  for (const [key, item] of Object.entries(parsed)) {
    if (typeof item === "string") out[key] = item;
  }
  return out;
}

function asObject(value: unknown): Record<string, unknown> {
  const parsed = parseJson(value);
  return isRecord(parsed) ? parsed : {};
}

function asStringList(value: unknown): string[] {
  const parsed = parseJson(value);
  return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
}

function asStatus(value: string): "active" | "archived" {
  return value === "archived" ? "archived" : "active";
}

function asCredentialType(value: string): MaCredentialType {
  if (value === "static_bearer" || value === "mcp_oauth" || value === "bearer" || value === "environment_variable") return value;
  throw new Error("invalid credential type");
}

function asIdentityKind(value: string): MaIdentityKind {
  if (value === "mcp_server_url" || value === "host" || value === "secret_name") return value;
  throw new Error("invalid credential identity");
}

function isUniqueViolation(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const coded = current as { code?: string; errno?: number; cause?: unknown; message?: string };
    if (coded.code === "23505" || coded.code === "ER_DUP_ENTRY" || coded.errno === 1062) return true;
    if (typeof coded.message === "string" && /duplicate key|ER_DUP_ENTRY|ma_credentials_vault_active_identity_uq/i.test(coded.message)) {
      return true;
    }
    current = coded.cause;
  }
  return false;
}

function publish(row: StoredCredential): MaCredential {
  return {
    id: row.id,
    tenantId: row.tenantId,
    vaultId: row.vaultId,
    displayName: row.displayName,
    type: row.type,
    identityKind: row.identityKind,
    identityKey: row.identityKey,
    publicConfig: row.publicConfig,
    secretFields: row.secretFields,
    hasSecret: row.secretCiphertext != null,
    status: row.status,
    expiresAt: row.expiresAt,
    lastRotatedAt: row.lastRotatedAt,
    lastResolvedAt: row.lastResolvedAt,
    createdBy: row.createdBy,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function mapCredential(row: CredentialDbRow): StoredCredential {
  return {
    id: row.id,
    tenantId: row.tenantId,
    vaultId: row.vaultId,
    displayName: row.displayName ?? null,
    type: asCredentialType(row.type),
    identityKind: asIdentityKind(row.identityKind),
    identityKey: row.identityKey,
    publicConfig: asObject(row.publicConfig),
    secretFields: asStringList(row.secretFields),
    secretCiphertext: row.secretCiphertext ?? null,
    wrappedDek: row.wrappedDek ?? null,
    kekId: row.kekId ?? null,
    hasSecret: row.secretCiphertext != null,
    status: asStatus(row.status),
    expiresAt: nullableIso(row.expiresAt),
    lastRotatedAt: nullableIso(row.lastRotatedAt),
    lastResolvedAt: nullableIso(row.lastResolvedAt),
    createdBy: row.createdBy ?? null,
    archivedAt: nullableIso(row.archivedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

function mapVault(row: VaultDbRow, credentialCount: number): MaVault {
  return {
    id: row.id,
    tenantId: row.tenantId,
    displayName: row.displayName,
    description: row.description ?? null,
    metadata: asMetadata(row.metadata),
    status: asStatus(row.status),
    credentialCount,
    createdBy: row.createdBy ?? null,
    archivedAt: nullableIso(row.archivedAt),
    createdAt: iso(row.createdAt),
    updatedAt: iso(row.updatedAt),
  };
}

async function countMap(tenantId: string): Promise<Map<string, number>> {
  const rows = isMysql()
    ? await mysqlCredentialCounts(tenantId)
    : await getIamDb()
        .select({ vaultId: pgCredentials.vaultId, n: sql<number>`count(*)` })
        .from(pgCredentials)
        .where(and(eq(pgCredentials.tenantId, tenantId), eq(pgCredentials.status, "active")))
        .groupBy(pgCredentials.vaultId);
  return new Map(rows.map((row) => [row.vaultId, Number(row.n) || 0]));
}

async function findVaultRow(tenantId: string, vaultId: string): Promise<VaultDbRow | null> {
  if (!ULID_RE.test(vaultId)) return null;
  if (isMysql()) return (await mysqlFindVault(tenantId, vaultId)) as VaultDbRow | null;
  const rows = await getIamDb()
    .select()
    .from(pgVaults)
    .where(and(eq(pgVaults.tenantId, tenantId), eq(pgVaults.id, vaultId)))
    .limit(1);
  return (rows[0] as VaultDbRow | undefined) ?? null;
}

async function findCredentialRow(tenantId: string, vaultId: string, credentialId: string): Promise<StoredCredential | null> {
  if (!ULID_RE.test(vaultId) || !ULID_RE.test(credentialId)) return null;
  const row = isMysql()
    ? await mysqlFindCredential(tenantId, vaultId, credentialId)
    : (
        await getIamDb()
          .select()
          .from(pgCredentials)
          .where(and(eq(pgCredentials.tenantId, tenantId), eq(pgCredentials.vaultId, vaultId), eq(pgCredentials.id, credentialId)))
          .limit(1)
      )[0];
  return row ? mapCredential(row as CredentialDbRow) : null;
}

async function countActive(tenantId: string, vaultId: string): Promise<number> {
  if (isMysql()) return mysqlCountActiveCredentials(tenantId, vaultId);
  const rows = await getIamDb()
    .select({ n: sql<number>`count(*)` })
    .from(pgCredentials)
    .where(and(eq(pgCredentials.tenantId, tenantId), eq(pgCredentials.vaultId, vaultId), eq(pgCredentials.status, "active")));
  return Number(rows[0]?.n ?? 0) || 0;
}

async function writePg(audit: AuditInsert, write: (tx: ReturnType<typeof getIamDb>) => Promise<unknown>): Promise<void> {
  await getIamDb().transaction(async (tx) => {
    await write(tx as ReturnType<typeof getIamDb>);
    await insertAuditEvent(audit, tx as ReturnType<typeof getIamDb>);
  });
}

export async function listMaVaults(tenantId: string, opts?: { includeArchived?: boolean }): Promise<MaVault[]> {
  const includeArchived = opts?.includeArchived === true;
  const rows = isMysql()
    ? await mysqlListVaults(tenantId, includeArchived)
    : await getIamDb()
        .select()
        .from(pgVaults)
        .where(and(eq(pgVaults.tenantId, tenantId), includeArchived ? undefined : eq(pgVaults.status, "active")))
        .orderBy(desc(pgVaults.createdAt));
  const counts = await countMap(tenantId);
  return (rows as VaultDbRow[]).map((row) => mapVault(row, counts.get(row.id) ?? 0));
}

export async function getMaVault(tenantId: string, vaultId: string): Promise<MaVault> {
  const row = await findVaultRow(tenantId, vaultId.trim());
  if (!row) throw new MaVaultNotFoundError();
  return mapVault(row, await countActive(tenantId, row.id));
}

export async function createMaVault(
  tenantId: string,
  input: { display_name?: unknown; description?: unknown; metadata?: unknown },
  actorUserId: string | null,
): Promise<MaVault> {
  const normalized = validateVaultInput(input, "create");
  if (!normalized.displayName) throw new MaVaultValidationError("display_name: is required");
  const now = new Date();
  const id = ulid();
  const row = {
    id,
    tenantId,
    displayName: normalized.displayName,
    description: normalized.description ?? null,
    metadata: normalized.metadata ?? {},
    status: "active",
    createdBy: actorUserId,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const audit: AuditInsert = {
    tenantId,
    actorUserId,
    eventType: "ma.vault.create",
    targetKind: "ma_vault",
    targetId: id,
    detail: { display_name: row.displayName },
  };
  if (isMysql()) await mysqlInsertVault(row, audit);
  else await writePg(audit, async (tx) => tx.insert(pgVaults).values(row));
  return getMaVault(tenantId, id);
}

export async function updateMaVault(
  tenantId: string,
  vaultId: string,
  patch: { display_name?: unknown; description?: unknown; metadata?: unknown },
  actorUserId: string | null,
): Promise<MaVault> {
  const existing = await getMaVault(tenantId, vaultId);
  if (existing.status === "archived") throw new MaVaultArchivedError();
  const normalized = validateVaultInput(patch, "update");
  const now = new Date();
  const set: { displayName?: string; description?: string | null; metadata?: Record<string, string>; updatedAt: Date } = { updatedAt: now };
  const changed: string[] = [];
  if (normalized.displayName !== undefined) {
    set.displayName = normalized.displayName;
    changed.push("display_name");
  }
  if (normalized.description !== undefined) {
    set.description = normalized.description;
    changed.push("description");
  }
  if (normalized.metadata !== undefined) {
    set.metadata = normalized.metadata;
    changed.push("metadata");
  }
  const audit: AuditInsert = {
    tenantId,
    actorUserId,
    eventType: "ma.vault.update",
    targetKind: "ma_vault",
    targetId: existing.id,
    detail: { changed },
  };
  if (isMysql()) await mysqlUpdateVault(tenantId, existing.id, set, audit);
  else await writePg(audit, async (tx) => tx.update(pgVaults).set(set).where(and(eq(pgVaults.tenantId, tenantId), eq(pgVaults.id, existing.id))));
  return getMaVault(tenantId, existing.id);
}

export async function archiveMaVault(tenantId: string, vaultId: string, actorUserId: string | null): Promise<MaVault> {
  const existing = await getMaVault(tenantId, vaultId);
  if (existing.status === "archived") return existing;
  const now = new Date();
  const auditBase = {
    tenantId,
    actorUserId,
    eventType: "ma.vault.archive",
    targetKind: "ma_vault",
    targetId: existing.id,
  };
  if (isMysql()) {
    await mysqlArchiveVault(tenantId, existing.id, now, auditBase);
  } else {
    await getIamDb().transaction(async (tx) => {
      const counts = await tx
        .select({ n: sql<number>`count(*)` })
        .from(pgCredentials)
        .where(and(eq(pgCredentials.tenantId, tenantId), eq(pgCredentials.vaultId, existing.id), eq(pgCredentials.status, "active")));
      const credentialCount = Number(counts[0]?.n ?? 0) || 0;
      await tx
        .update(pgVaults)
        .set({ status: "archived", archivedAt: now, updatedAt: now })
        .where(and(eq(pgVaults.tenantId, tenantId), eq(pgVaults.id, existing.id)));
      await tx
        .update(pgCredentials)
        .set({
          status: "archived",
          archivedAt: now,
          secretCiphertext: null,
          wrappedDek: null,
          kekId: null,
          activeIdentityKey: null,
          updatedAt: now,
        })
        .where(and(eq(pgCredentials.tenantId, tenantId), eq(pgCredentials.vaultId, existing.id), eq(pgCredentials.status, "active")));
      await insertAuditEvent({ ...auditBase, detail: { credential_count: credentialCount } }, tx as ReturnType<typeof getIamDb>);
    });
  }
  return getMaVault(tenantId, existing.id);
}

export async function deleteMaVault(tenantId: string, vaultId: string, actorUserId: string | null): Promise<void> {
  const existing = await getMaVault(tenantId, vaultId);
  if (existing.status !== "archived") throw new MaVaultNotArchivedError();
  const audit: AuditInsert = {
    tenantId,
    actorUserId,
    eventType: "ma.vault.delete",
    targetKind: "ma_vault",
    targetId: existing.id,
    detail: { display_name: existing.displayName },
  };
  if (isMysql()) await mysqlDeleteVault(tenantId, existing.id, audit);
  else {
    await getIamDb().transaction(async (tx) => {
      await insertAuditEvent(audit, tx as ReturnType<typeof getIamDb>);
      await tx.delete(pgVaults).where(and(eq(pgVaults.tenantId, tenantId), eq(pgVaults.id, existing.id)));
    });
  }
}

async function requireActiveVault(tenantId: string, vaultId: string): Promise<MaVault> {
  const vault = await getMaVault(tenantId, vaultId);
  if (vault.status === "archived") throw new MaVaultArchivedError();
  return vault;
}

export async function listMaCredentials(tenantId: string, vaultId: string, opts?: { includeArchived?: boolean }): Promise<MaCredential[]> {
  await getMaVault(tenantId, vaultId);
  const includeArchived = opts?.includeArchived === true;
  const rows = isMysql()
    ? await mysqlListCredentials(tenantId, vaultId.trim(), includeArchived)
    : await getIamDb()
        .select()
        .from(pgCredentials)
        .where(
          and(
            eq(pgCredentials.tenantId, tenantId),
            eq(pgCredentials.vaultId, vaultId.trim()),
            includeArchived ? undefined : eq(pgCredentials.status, "active"),
          ),
        )
        .orderBy(asc(pgCredentials.createdAt), asc(pgCredentials.id));
  return (rows as CredentialDbRow[]).map((row) => publish(mapCredential(row)));
}

export async function getMaCredential(tenantId: string, vaultId: string, credentialId: string): Promise<MaCredential> {
  await getMaVault(tenantId, vaultId);
  const row = await findCredentialRow(tenantId, vaultId.trim(), credentialId.trim());
  if (!row) throw new MaCredentialNotFoundError();
  return publish(row);
}

export async function createMaCredential(
  tenantId: string,
  vaultId: string,
  body: Record<string, unknown>,
  actorUserId: string | null,
): Promise<MaCredential> {
  const vault = await requireActiveVault(tenantId, vaultId);
  const normalized = normalizeCredentialCreate(body);
  if ((await countActive(tenantId, vault.id)) >= MA_VAULT_CREDENTIAL_LIMIT) throw new MaVaultCredentialLimitError();
  const sealed = sealSecretPayload(normalized.secrets);
  const now = new Date();
  const id = ulid();
  const row = {
    id,
    tenantId,
    vaultId: vault.id,
    displayName: normalized.displayName,
    type: normalized.type,
    identityKind: normalized.identityKind,
    identityKey: normalized.identityKey,
    activeIdentityKey: `${normalized.identityKind}:${normalized.identityKey}`,
    publicConfig: normalized.publicConfig,
    secretFields: Object.keys(normalized.secrets).sort(),
    secretCiphertext: sealed.ciphertext,
    wrappedDek: sealed.wrappedDek,
    kekId: sealed.kekId,
    status: "active",
    expiresAt: normalized.expiresAt ? new Date(normalized.expiresAt) : null,
    lastRotatedAt: null,
    lastResolvedAt: null,
    createdBy: actorUserId,
    archivedAt: null,
    createdAt: now,
    updatedAt: now,
  };
  const audit: AuditInsert = {
    tenantId,
    actorUserId,
    eventType: "ma.credential.create",
    targetKind: "ma_credential",
    targetId: id,
    detail: { vault_id: vault.id, type: normalized.type, identity_kind: normalized.identityKind, identity_key: normalized.identityKey },
  };
  try {
    if (isMysql()) await mysqlInsertCredential(row, audit);
    else await writePg(audit, async (tx) => tx.insert(pgCredentials).values(row));
  } catch (error) {
    if (isUniqueViolation(error)) throw new MaCredentialIdentityConflictError();
    throw error;
  }
  return getMaCredential(tenantId, vault.id, id);
}

export async function rotateMaCredential(
  tenantId: string,
  vaultId: string,
  credentialId: string,
  body: Record<string, unknown>,
  actorUserId: string | null,
): Promise<MaCredential> {
  const vault = await requireActiveVault(tenantId, vaultId);
  const existing = await findCredentialRow(tenantId, vault.id, credentialId.trim());
  if (!existing || existing.status === "archived") throw new MaCredentialNotFoundError();
  const patch = normalizeCredentialPatch({ type: existing.type, publicConfig: existing.publicConfig }, body);
  const now = new Date();
  const publicConfig = { ...existing.publicConfig };
  const changed: string[] = [];
  for (const [key, value] of Object.entries(patch.publicConfigPatch)) {
    if (value === null) delete publicConfig[key];
    else publicConfig[key] = value;
    changed.push(key);
  }
  const set: Record<string, unknown> = { updatedAt: now, publicConfig };
  if (patch.displayName !== undefined) {
    set.displayName = patch.displayName;
    changed.push("display_name");
  }
  if (patch.expiresAt !== undefined) {
    set.expiresAt = patch.expiresAt ? new Date(patch.expiresAt) : null;
    changed.push("expires_at");
  }
  if (Object.keys(patch.secrets).length > 0 || patch.clearSecrets.length > 0) {
    if (!existing.secretCiphertext || !existing.wrappedDek || !existing.kekId) {
      const error = new VaultDecryptError("cannot decrypt credential");
      error.credentialId = existing.id;
      throw error;
    }
    let current: Record<string, string>;
    try {
      current = openSecretPayload({
        ciphertext: existing.secretCiphertext,
        wrappedDek: existing.wrappedDek,
        kekId: existing.kekId,
      });
    } catch (error) {
      if (error instanceof VaultDecryptError) error.credentialId = existing.id;
      throw error;
    }
    const merged = { ...current, ...patch.secrets };
    for (const key of patch.clearSecrets) delete merged[key];
    assertCredentialSecrets(existing.type, publicConfig, merged);
    const sealed = sealSecretPayload(merged);
    set.secretCiphertext = sealed.ciphertext;
    set.wrappedDek = sealed.wrappedDek;
    set.kekId = sealed.kekId;
    set.secretFields = Object.keys(merged).sort();
    set.lastRotatedAt = now;
    for (const key of [...Object.keys(patch.secrets), ...patch.clearSecrets]) {
      if (!changed.includes(key)) changed.push(key);
    }
  }
  const audit: AuditInsert = {
    tenantId,
    actorUserId,
    eventType: "ma.credential.rotate",
    targetKind: "ma_credential",
    targetId: existing.id,
    detail: { changed },
  };
  if (isMysql()) await mysqlUpdateCredential(tenantId, vault.id, existing.id, set, audit);
  else await writePg(audit, async (tx) => tx.update(pgCredentials).set(set).where(and(eq(pgCredentials.tenantId, tenantId), eq(pgCredentials.id, existing.id))));
  return getMaCredential(tenantId, vault.id, existing.id);
}

export async function archiveMaCredential(
  tenantId: string,
  vaultId: string,
  credentialId: string,
  actorUserId: string | null,
): Promise<MaCredential> {
  await getMaVault(tenantId, vaultId);
  const existing = await findCredentialRow(tenantId, vaultId.trim(), credentialId.trim());
  if (!existing) throw new MaCredentialNotFoundError();
  if (existing.status === "archived") return publish(existing);
  const now = new Date();
  const set = {
    status: "archived",
    archivedAt: now,
    secretCiphertext: null,
    wrappedDek: null,
    kekId: null,
    activeIdentityKey: null,
    updatedAt: now,
  };
  const audit: AuditInsert = {
    tenantId,
    actorUserId,
    eventType: "ma.credential.archive",
    targetKind: "ma_credential",
    targetId: existing.id,
    detail: { vault_id: existing.vaultId },
  };
  if (isMysql()) await mysqlUpdateCredential(tenantId, existing.vaultId, existing.id, set, audit);
  else await writePg(audit, async (tx) => tx.update(pgCredentials).set(set).where(and(eq(pgCredentials.tenantId, tenantId), eq(pgCredentials.id, existing.id))));
  return getMaCredential(tenantId, existing.vaultId, existing.id);
}

export async function deleteMaCredential(tenantId: string, vaultId: string, credentialId: string, actorUserId: string | null): Promise<void> {
  await getMaVault(tenantId, vaultId);
  const existing = await findCredentialRow(tenantId, vaultId.trim(), credentialId.trim());
  if (!existing) throw new MaCredentialNotFoundError();
  const audit: AuditInsert = {
    tenantId,
    actorUserId,
    eventType: "ma.credential.delete",
    targetKind: "ma_credential",
    targetId: existing.id,
    detail: { vault_id: existing.vaultId },
  };
  if (isMysql()) await mysqlDeleteCredential(tenantId, existing.vaultId, existing.id, audit);
  else {
    await getIamDb().transaction(async (tx) => {
      await insertAuditEvent(audit, tx as ReturnType<typeof getIamDb>);
      await tx.delete(pgCredentials).where(and(eq(pgCredentials.tenantId, tenantId), eq(pgCredentials.id, existing.id)));
    });
  }
}

function matchedUrls(manifest: unknown, keys: Set<string>): string[] {
  const parsed = parseJson(manifest);
  if (!isRecord(parsed) || !Array.isArray(parsed.mcp_servers)) return [];
  const matched: string[] = [];
  for (const server of parsed.mcp_servers) {
    if (!isRecord(server) || typeof server.url !== "string") continue;
    const url = normalizeMcpServerUrlKeepingQuery(server.url);
    if (url && keys.has(url) && !matched.includes(url)) matched.push(url);
  }
  return matched;
}

export async function listVaultReferences(tenantId: string, vaultId: string): Promise<VaultReferences> {
  const vault = await getMaVault(tenantId, vaultId);
  const sessionFilters = and(
    eq(pgSessions.tenantId, tenantId),
    isNull(pgSessions.archivedAt),
    notInArray(pgSessions.status, ["archived", "terminated"]),
    sql`${pgSessions.vaultIds} @> jsonb_build_array(${vault.id}::text)`,
  );
  const sessions = isMysql()
    ? await mysqlListSessionReferences(tenantId, vault.id)
    : {
        activeCount: Number(
          (
            await getIamDb().select({ n: sql<number>`count(*)` }).from(pgSessions).where(sessionFilters)
          )[0]?.n ?? 0,
        ) || 0,
        recent: await getIamDb()
          .select({
            id: pgSessions.id,
            agentId: pgSessions.agentId,
            status: pgSessions.status,
            createdByUserId: pgSessions.createdByUserId,
            createdAt: pgSessions.createdAt,
          })
          .from(pgSessions)
          .where(sessionFilters)
          .orderBy(desc(pgSessions.createdAt))
          .limit(20),
      };
  const credentials = await listMaCredentials(tenantId, vault.id);
  const keys = new Set(
    credentials.filter((item) => item.type === "static_bearer" || item.type === "mcp_oauth").map((item) => item.identityKey),
  );
  const manifests = isMysql()
    ? await mysqlListAgentManifests(tenantId)
    : await getIamDb()
        .select({
          id: pgAgents.id,
          displayName: pgAgents.displayName,
          latestVersion: pgAgents.latestVersion,
          manifest: pgVersions.manifest,
        })
        .from(pgAgents)
        .innerJoin(
          pgVersions,
          and(eq(pgVersions.agentId, pgAgents.id), eq(pgVersions.tenantId, tenantId), eq(pgVersions.version, pgAgents.latestVersion)),
        )
        .where(and(eq(pgAgents.tenantId, tenantId), eq(pgAgents.status, "active")));
  const agents = manifests.flatMap((row) => {
    const matched = matchedUrls(row.manifest, keys);
    return matched.length
      ? [{ id: row.id, display_name: row.displayName, latest_version: row.latestVersion, matched }]
      : [];
  });
  return {
    sessions: {
      active_count: sessions.activeCount,
      recent: sessions.recent.map((row) => ({
        id: row.id,
        agent_id: row.agentId,
        status: row.status,
        created_by_user_id: row.createdByUserId ?? null,
        created_at: iso(row.createdAt),
      })),
    },
    agents,
  };
}

export async function validateVaultIds(
  tenantId: string,
  vaultIds: string[],
): Promise<Array<{ id: string; status: "active" | "archived" | "missing" }>> {
  const lookup = vaultIds.filter((id) => ULID_RE.test(id));
  const rows = isMysql()
    ? await mysqlVaultStatuses(tenantId, lookup)
    : lookup.length === 0
      ? []
      : await getIamDb()
          .select({ id: pgVaults.id, status: pgVaults.status })
          .from(pgVaults)
          .where(and(eq(pgVaults.tenantId, tenantId), inArray(pgVaults.id, lookup)));
  const byId = new Map(rows.map((row) => [row.id, row.status]));
  return vaultIds.map((id) => {
    const status = byId.get(id);
    if (status === "active" || status === "archived") return { id, status };
    return { id, status: "missing" as const };
  });
}

function idleRefresh(secrets: Record<string, string>, expiresAt: string | null): RefreshOutcome {
  return { secrets, expiresAt, refreshed: false, failed: false, status: 0 };
}

export async function refreshMcpOAuthIfNeeded(
  cred: { type: MaCredentialType; publicConfig: Record<string, unknown>; expiresAt: string | null },
  secrets: Record<string, string>,
  opts: { fetchImpl?: typeof fetch; now?: () => Date } = {},
): Promise<RefreshOutcome> {
  const refresh = readRefreshPublic(cred.publicConfig.refresh);
  const now = opts.now?.() ?? new Date();
  if (cred.type !== "mcp_oauth" || !refresh || !secrets.refresh_token || !cred.expiresAt) {
    return idleRefresh(secrets, cred.expiresAt);
  }
  const expiresMs = Date.parse(cred.expiresAt);
  if (Number.isNaN(expiresMs) || expiresMs - now.getTime() > 300_000) return idleRefresh(secrets, cred.expiresAt);
  const fetchImpl = opts.fetchImpl ?? fetch;
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", secrets.refresh_token);
  if (refresh.scope) body.set("scope", refresh.scope);
  if (refresh.resource) body.set("resource", refresh.resource);
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded" };
  if (refresh.token_endpoint_auth_type === "client_secret_basic") {
    const encoded = Buffer.from(`${encodeURIComponent(refresh.client_id)}:${encodeURIComponent(secrets.client_secret ?? "")}`).toString("base64");
    headers.authorization = `Basic ${encoded}`;
  } else if (refresh.token_endpoint_auth_type === "client_secret_post") {
    body.set("client_id", refresh.client_id);
    body.set("client_secret", secrets.client_secret ?? "");
  } else {
    body.set("client_id", refresh.client_id);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetchImpl(refresh.token_endpoint, {
      method: "POST",
      headers,
      body: body.toString(),
      redirect: "error",
      signal: controller.signal,
    });
    if (response.status !== 200) return { secrets, expiresAt: cred.expiresAt, refreshed: false, failed: true, status: response.status };
    const payload: unknown = await response.json();
    if (!isRecord(payload)) {
      return { secrets, expiresAt: cred.expiresAt, refreshed: false, failed: true, status: response.status };
    }
    const accessToken = payload.access_token;
    const expiresIn = payload.expires_in;
    const rotatedRefresh = payload.refresh_token;
    if (typeof accessToken !== "string" || !accessToken) {
      return { secrets, expiresAt: cred.expiresAt, refreshed: false, failed: true, status: response.status };
    }
    if (expiresIn != null && !Number.isInteger(expiresIn)) {
      return { secrets, expiresAt: cred.expiresAt, refreshed: false, failed: true, status: response.status };
    }
    const next: Record<string, string> = { ...secrets, access_token: accessToken };
    if (typeof rotatedRefresh === "string" && rotatedRefresh) next.refresh_token = rotatedRefresh;
    const expiresAt = Number.isInteger(expiresIn)
      ? new Date(now.getTime() + (expiresIn as number) * 1000).toISOString()
      : null;
    return { secrets: next, expiresAt, refreshed: true, failed: false, status: 200 };
  } catch {
    return { secrets, expiresAt: cred.expiresAt, refreshed: false, failed: true, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

function failDecrypt(credentialId: string): VaultDecryptError {
  const error = new VaultDecryptError("cannot decrypt credential");
  error.credentialId = credentialId;
  return error;
}

function buildResolved(
  row: StoredCredential,
  secrets: Record<string, string>,
  vaultIndex: number,
  expiresAt: string | null,
  refreshError?: "failed",
): ResolvedCredential {
  const common = {
    credential_id: row.id,
    vault_id: row.vaultId,
    vault_index: vaultIndex,
    display_name: row.displayName,
  };
  switch (row.type) {
    case "static_bearer":
      return { ...common, type: "static_bearer", mcp_server_url: row.identityKey, token: secrets.token ?? "" };
    case "bearer":
      return { ...common, type: "bearer", host: row.identityKey, token: secrets.token ?? "" };
    case "environment_variable": {
      const networking = readNetworking(row.publicConfig.networking);
      if (!networking || !secrets.secret_value) throw failDecrypt(row.id);
      return {
        ...common,
        type: "environment_variable",
        secret_name: row.identityKey,
        secret_value: secrets.secret_value,
        networking,
      };
    }
    case "mcp_oauth": {
      if (!secrets.access_token) throw failDecrypt(row.id);
      return {
        ...common,
        type: "mcp_oauth",
        mcp_server_url: row.identityKey,
        access_token: secrets.access_token,
        expires_at: expiresAt,
        ...(refreshError ? { refresh_error: "failed" as const } : {}),
      };
    }
    default: {
      const unreachable: never = row.type;
      throw new Error(String(unreachable));
    }
  }
}

async function defaultFindVault(tenantId: string, vaultId: string): Promise<{ id: string; status: string } | null> {
  const row = await findVaultRow(tenantId, vaultId);
  return row ? { id: row.id, status: row.status } : null;
}

async function defaultListActive(tenantId: string, vaultId: string): Promise<StoredCredential[]> {
  const rows = isMysql()
    ? await mysqlListCredentials(tenantId, vaultId, false)
    : await getIamDb()
        .select()
        .from(pgCredentials)
        .where(and(eq(pgCredentials.tenantId, tenantId), eq(pgCredentials.vaultId, vaultId), eq(pgCredentials.status, "active")))
        .orderBy(asc(pgCredentials.createdAt), asc(pgCredentials.id));
  return (rows as CredentialDbRow[]).map(mapCredential).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

async function defaultWriteRefreshed(row: StoredCredential, sealed: SealedSecret, secretFields: string[], expiresAt: string | null, now: Date): Promise<void> {
  const patch = {
    secretCiphertext: sealed.ciphertext,
    wrappedDek: sealed.wrappedDek,
    kekId: sealed.kekId,
    secretFields,
    expiresAt: expiresAt ? new Date(expiresAt) : null,
    updatedAt: now,
  };
  if (isMysql()) {
    await mysqlWriteRefreshed(row.tenantId, row.vaultId, row.id, patch);
    return;
  }
  await getIamDb()
    .update(pgCredentials)
    .set(patch)
    .where(and(eq(pgCredentials.tenantId, row.tenantId), eq(pgCredentials.id, row.id)));
}

export async function resolveVaultBundle(input: ResolveInput, deps: ResolveDeps = {}): Promise<ResolvedBundle> {
  const now = deps.now?.() ?? new Date();
  const findVault = deps.findVault ?? defaultFindVault;
  const listActiveCredentials = deps.listActiveCredentials ?? defaultListActive;
  const writeRefreshed = deps.writeRefreshed ?? defaultWriteRefreshed;
  const touchResolved = deps.touchResolved ?? (isMysql() ? mysqlTouchResolved : touchPg);
  const insertAudit = deps.insertAudit ?? insertAuditEvent;
  const openPayload = deps.openPayload ?? openSecretPayload;
  const credentials: ResolvedCredential[] = [];
  const skipped: Array<{ vault_id: string; reason: "not_found" | "archived" }> = [];
  const refreshed: string[] = [];
  const refreshFailed: string[] = [];

  for (const [vaultIndex, vaultId] of input.vaultIds.entries()) {
    const vault = await findVault(input.tenantId, vaultId);
    if (!vault) {
      skipped.push({ vault_id: vaultId, reason: "not_found" });
      continue;
    }
    if (vault.status !== "active") {
      skipped.push({ vault_id: vaultId, reason: "archived" });
      continue;
    }
    const rows = [...(await listActiveCredentials(input.tenantId, vault.id))].sort(
      (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
    );
    for (const row of rows) {
      if (!row.secretCiphertext || !row.wrappedDek || !row.kekId) throw failDecrypt(row.id);
      let secrets: Record<string, string>;
      try {
        secrets = openPayload({ ciphertext: row.secretCiphertext, wrappedDek: row.wrappedDek, kekId: row.kekId });
      } catch (error) {
        const decryptError = error instanceof VaultDecryptError ? error : failDecrypt(row.id);
        decryptError.credentialId = row.id;
        try {
          await insertAudit({
            tenantId: input.tenantId,
            actorUserId: null,
            eventType: "ma.vault.resolve",
            targetKind: "ma_session",
            targetId: input.sessionId,
            detail: { ok: false, error: "decrypt_failed", credential_id: row.id },
          });
        } catch {
          console.error("ma.vault.resolve_audit_failed", { sessionId: input.sessionId, credentialId: row.id });
        }
        throw decryptError;
      }
      let expiresAt = row.expiresAt;
      let refreshError: "failed" | undefined;
      const outcome = await refreshMcpOAuthIfNeeded(
        { type: row.type, publicConfig: row.publicConfig, expiresAt: row.expiresAt },
        secrets,
        { fetchImpl: deps.fetchImpl, now: () => now },
      );
      secrets = outcome.secrets;
      expiresAt = outcome.expiresAt;
      if (outcome.refreshed) {
        const sealed = sealSecretPayload(secrets);
        await writeRefreshed(row, sealed, Object.keys(secrets).sort(), outcome.expiresAt, now);
        refreshed.push(row.id);
        await insertAudit({
          tenantId: input.tenantId,
          actorUserId: null,
          eventType: "ma.credential.refresh",
          targetKind: "ma_credential",
          targetId: row.id,
          detail: { ok: true },
        });
      } else if (outcome.failed) {
        refreshError = "failed";
        refreshFailed.push(row.id);
        await insertAudit({
          tenantId: input.tenantId,
          actorUserId: null,
          eventType: "ma.credential.refresh",
          targetKind: "ma_credential",
          targetId: row.id,
          detail: { ok: false, status: outcome.status },
        });
      }
      const resolved = buildResolved(row, secrets, vaultIndex, expiresAt, refreshError);
      if ((resolved.type === "static_bearer" || resolved.type === "bearer") && !resolved.token) throw failDecrypt(row.id);
      credentials.push(resolved);
    }
  }

  try {
    await touchResolved(input.tenantId, credentials.map((item) => item.credential_id), now);
  } catch {
    console.error("ma.vault.touch_resolved_failed", { sessionId: input.sessionId });
  }

  const types: Record<string, number> = {};
  for (const item of credentials) types[item.type] = (types[item.type] ?? 0) + 1;
  return {
    session_id: input.sessionId,
    resolved_at: now.toISOString(),
    credentials,
    skipped,
    auditDetail: {
      caller: "agent-runtime",
      session_user_id: input.sessionUserId,
      vault_ids: input.vaultIds,
      credential_ids: credentials.map((item) => item.credential_id),
      types,
      skipped,
      refreshed,
      refresh_failed: refreshFailed,
    },
  };
}

async function touchPg(tenantId: string, ids: string[], at: Date): Promise<void> {
  if (ids.length === 0) return;
  await getIamDb()
    .update(pgCredentials)
    .set({ lastResolvedAt: at })
    .where(and(eq(pgCredentials.tenantId, tenantId), inArray(pgCredentials.id, ids)));
}
