/**
 * admin-console · MCP Server 持久化（PG）
 */

import { getAdminMysqlDb } from "./database";
import { mcpServerVersions, mcpServers, mcpTools } from "@agenticx/db-schema/mysql";
import { and, desc, eq, sql } from "drizzle-orm";
import { ulid } from "ulid";

import { decryptBackendConfig, encryptBackendConfig } from "../../mcp-backend-config-crypto";
import {
  assertCanPublishCurrent,
  assertCanPublishDraft,
  assertCanRollback,
  nextVersionNumber,
  storedJsonToTool,
  surfaceContentHash,
  toolToStoredJson,
  versionManaged,
  type McpShelfStatus,
  type VersionTool,
} from "../../mcp-server-versions";

export type McpServerStatus = "active" | "disabled";

export interface McpServerRecord {
  id: string;
  tenantId: string;
  name: string;
  displayName: string;
  transport: string;
  backendType: string;
  backendConfig: Record<string, unknown>;
  requiredScopes: string[];
  status: McpServerStatus;
  publishedVersionId: string | null;
  rateLimit: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface McpToolRecord {
  id: string;
  serverId: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  enabled: boolean;
  sourceOperationId?: string;
  metadata: Record<string, unknown>;
}

export interface CreateMcpServerInput {
  name: string;
  displayName?: string;
  transport?: string;
  backendType: string;
  backendConfig?: Record<string, unknown>;
  requiredScopes?: string[];
  status?: McpServerStatus;
  rateLimit?: Record<string, unknown>;
}

export interface UpdateMcpServerInput {
  displayName?: string;
  transport?: string;
  backendType?: string;
  backendConfig?: Record<string, unknown>;
  requiredScopes?: string[];
  status?: McpServerStatus;
  rateLimit?: Record<string, unknown>;
  /** 只由路由从会话写入，不接受请求体里的同名字段。 */
  createdBy?: string;
}

function requiredTenantId(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for MCP server persistence.");
  return t;
}

function rowToServer(row: typeof mcpServers.$inferSelect): McpServerRecord {
  return {
    id: row.id,
    tenantId: row.tenantId,
    name: row.name,
    displayName: row.displayName ?? "",
    transport: row.transport,
    backendType: row.backendType,
    backendConfig: decryptBackendConfig(row.backendConfig),
    requiredScopes: Array.isArray(row.requiredScopes) ? row.requiredScopes.map(String) : [],
    status: (row.status as McpServerStatus) || "active",
    publishedVersionId: row.publishedVersionId ?? null,
    rateLimit: (row.rateLimit as Record<string, unknown>) ?? {},
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
    updatedAt: row.updatedAt instanceof Date ? row.updatedAt.toISOString() : String(row.updatedAt),
  };
}

function rowToTool(row: typeof mcpTools.$inferSelect): McpToolRecord {
  return {
    id: row.id,
    serverId: row.serverId,
    toolName: row.toolName,
    description: row.description ?? "",
    inputSchema: (row.inputSchema as Record<string, unknown>) ?? {},
    outputSchema: row.outputSchema ? (row.outputSchema as Record<string, unknown>) : undefined,
    enabled: row.enabled,
    sourceOperationId: row.sourceOperationId ?? undefined,
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

export async function listMcpServers(): Promise<McpServerRecord[]> {
  const db = getAdminMysqlDb();
  const tenantId = requiredTenantId();
  const rows = await db
    .select()
    .from(mcpServers)
    .where(eq(mcpServers.tenantId, tenantId))
    .orderBy(desc(mcpServers.updatedAt));
  return rows.map(rowToServer);
}

export async function getMcpServer(id: string): Promise<McpServerRecord | null> {
  const db = getAdminMysqlDb();
  const tenantId = requiredTenantId();
  const rows = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.tenantId, tenantId), eq(mcpServers.id, id)))
    .limit(1);
  return rows[0] ? rowToServer(rows[0]) : null;
}

export async function createMcpServer(input: CreateMcpServerInput): Promise<McpServerRecord> {
  const db = getAdminMysqlDb();
  const tenantId = requiredTenantId();
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  const id = ulid();
  const now = new Date();
  await db.insert(mcpServers).values({
    id,
    tenantId,
    name,
    displayName: input.displayName?.trim() || name,
    transport: input.transport?.trim() || "streamable-http",
    backendType: input.backendType.trim(),
    backendConfig: encryptBackendConfig(input.backendConfig),
    requiredScopes: input.requiredScopes ?? [],
    status: input.status ?? "active",
    rateLimit: input.rateLimit ?? { tool_calls_per_minute: 60 },
    createdAt: now,
    updatedAt: now,
  });
  const created = await getMcpServer(id);
  if (!created) throw new Error("create failed");
  return created;
}

export async function updateMcpServer(id: string, input: UpdateMcpServerInput): Promise<McpServerRecord> {
  const db = getAdminMysqlDb();
  const tenantId = requiredTenantId();
  const deferBackend = input.backendConfig !== undefined && (await isServerVersionManaged(id));
  const patch: Partial<typeof mcpServers.$inferInsert> = { updatedAt: new Date() };
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.transport !== undefined) patch.transport = input.transport;
  if (input.backendType !== undefined) patch.backendType = input.backendType;
  if (input.backendConfig !== undefined && !deferBackend) patch.backendConfig = encryptBackendConfig(input.backendConfig);
  if (input.requiredScopes !== undefined) patch.requiredScopes = input.requiredScopes;
  if (input.status !== undefined) patch.status = input.status;
  if (input.rateLimit !== undefined) patch.rateLimit = input.rateLimit;
  await db.update(mcpServers).set(patch).where(and(eq(mcpServers.tenantId, tenantId), eq(mcpServers.id, id)));
  if (deferBackend && input.backendConfig) {
    await insertToolSurfaceDraft(id, {
      tools: await toolsForNextDraft(id),
      backendConfig: encryptBackendConfig(input.backendConfig),
      createdBy: input.createdBy,
    });
  }
  const updated = await getMcpServer(id);
  if (!updated) throw new Error("server not found");
  return updated;
}

export async function deleteMcpServer(id: string): Promise<void> {
  const db = getAdminMysqlDb();
  const tenantId = requiredTenantId();
  await db.delete(mcpServers).where(and(eq(mcpServers.tenantId, tenantId), eq(mcpServers.id, id)));
}

export async function listMcpTools(serverId: string): Promise<McpToolRecord[]> {
  const db = getAdminMysqlDb();
  const rows = await db.select().from(mcpTools).where(eq(mcpTools.serverId, serverId)).orderBy(mcpTools.toolName);
  return rows.map(rowToTool);
}

export async function replaceMcpTools(serverId: string, tools: Omit<McpToolRecord, "id" | "serverId">[]): Promise<McpToolRecord[]> {
  if (await isServerVersionManaged(serverId)) {
    await insertToolSurfaceDraft(serverId, {
      tools: recordsToVersionTools(tools),
      backendConfig: await storedBackendForDraft(serverId),
    });
    return listMcpTools(serverId);
  }
  return writeLiveTools(serverId, tools);
}

async function writeLiveTools(serverId: string, tools: Omit<McpToolRecord, "id" | "serverId">[]): Promise<McpToolRecord[]> {
  const db = getAdminMysqlDb();
  await db.delete(mcpTools).where(eq(mcpTools.serverId, serverId));
  const now = new Date();
  for (const tool of tools) {
    await db.insert(mcpTools).values({
      id: ulid(),
      serverId,
      toolName: tool.toolName,
      description: tool.description,
      inputSchema: tool.inputSchema,
      outputSchema: tool.outputSchema,
      enabled: tool.enabled,
      sourceOperationId: tool.sourceOperationId,
      metadata: tool.metadata ?? {},
      createdAt: now,
      updatedAt: now,
    });
  }
  return listMcpTools(serverId);
}

export interface McpHealthStats {
  callCount: number;
  failCount: number;
  p50LatencyMs: number;
}

export async function getMcpServerHealth(serverName: string): Promise<McpHealthStats> {
  const db = getAdminMysqlDb();
  const tenantId = requiredTenantId();
  const since = new Date(Date.now() - 60 * 60 * 1000);
  const result = await db.execute(sql`
    WITH ranked AS (
      SELECT
        latency_ms,
        mcp_status,
        ROW_NUMBER() OVER (ORDER BY latency_ms) AS rn,
        COUNT(*) OVER () AS cnt
      FROM gateway_audit_events
      WHERE tenant_id = ${tenantId}
        AND mcp_server = ${serverName}
        AND event_time >= ${since}
    )
    SELECT
      COUNT(*) AS call_count,
      COALESCE(SUM(CASE WHEN mcp_status <> 'ok' OR mcp_status IS NULL THEN 1 ELSE 0 END), 0) AS fail_count,
      COALESCE(MIN(CASE WHEN rn >= CEIL(cnt * 0.5) THEN latency_ms END), 0) AS p50_latency_ms
    FROM ranked
  `);
  const rows = result[0];
  const row = (Array.isArray(rows) ? rows[0] : {}) as Record<string, unknown>;
  return {
    callCount: Number(row.call_count ?? 0),
    failCount: Number(row.fail_count ?? 0),
    p50LatencyMs: Number(row.p50_latency_ms ?? 0),
  };
}

export interface McpServerVersionSummary {
  id: string;
  version: number;
  shelfStatus: McpShelfStatus;
  createdBy: string | null;
  createdAt: string;
  publishedAt: string | null;
  toolCount: number;
}

function isoTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function asShelf(value: string): McpShelfStatus {
  if (value === "draft" || value === "published") return value;
  throw new Error("version not found");
}

function recordsToVersionTools(tools: Array<Omit<McpToolRecord, "id" | "serverId"> | McpToolRecord>): VersionTool[] {
  return tools.map((tool) => ({
    toolName: tool.toolName,
    description: tool.description,
    inputSchema: tool.inputSchema ?? {},
    outputSchema: tool.outputSchema ?? null,
    enabled: tool.enabled,
    sourceOperationId: tool.sourceOperationId ?? null,
    metadata: tool.metadata ?? {},
  }));
}

function versionToolsToRecords(tools: VersionTool[]): Omit<McpToolRecord, "id" | "serverId">[] {
  return tools.map((tool) => ({
    toolName: tool.toolName,
    description: tool.description,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema ?? undefined,
    enabled: tool.enabled,
    sourceOperationId: tool.sourceOperationId ?? undefined,
    metadata: tool.metadata ?? {},
  }));
}

async function loadServerRow(serverId: string) {
  const db = getAdminMysqlDb();
  const tenantId = requiredTenantId();
  const rows = await db
    .select()
    .from(mcpServers)
    .where(and(eq(mcpServers.tenantId, tenantId), eq(mcpServers.id, serverId)))
    .limit(1);
  return rows[0] ?? null;
}

async function loadVersionNumbers(serverId: string): Promise<number[]> {
  const db = getAdminMysqlDb();
  const rows = await db
    .select({ version: mcpServerVersions.version })
    .from(mcpServerVersions)
    .where(eq(mcpServerVersions.serverId, serverId));
  return rows.map((row) => row.version);
}

async function isServerVersionManaged(serverId: string): Promise<boolean> {
  const row = await loadServerRow(serverId);
  if (!row) return false;
  const numbers = await loadVersionNumbers(serverId);
  return versionManaged(row.publishedVersionId, numbers.length);
}

async function toolsForNextDraft(serverId: string): Promise<VersionTool[]> {
  const row = await loadServerRow(serverId);
  if (!row) throw new Error("server not found");
  if (row.publishedVersionId) {
    const db = getAdminMysqlDb();
    const versions = await db
      .select()
      .from(mcpServerVersions)
      .where(eq(mcpServerVersions.id, row.publishedVersionId))
      .limit(1);
    const tools = versions[0]?.toolsJson;
    if (Array.isArray(tools)) return tools.map(storedJsonToTool);
  }
  return recordsToVersionTools(await listMcpTools(serverId));
}

async function storedBackendForDraft(serverId: string): Promise<Record<string, unknown>> {
  const row = await loadServerRow(serverId);
  if (!row) throw new Error("server not found");
  if (row.publishedVersionId) {
    const db = getAdminMysqlDb();
    const versions = await db
      .select()
      .from(mcpServerVersions)
      .where(eq(mcpServerVersions.id, row.publishedVersionId))
      .limit(1);
    const config = versions[0]?.backendConfigJson;
    if (config && typeof config === "object" && !Array.isArray(config)) return config;
  }
  return (row.backendConfig as Record<string, unknown>) ?? {};
}

async function insertToolSurfaceDraft(
  serverId: string,
  input: { tools: VersionTool[]; backendConfig: Record<string, unknown>; createdBy?: string },
): Promise<McpDraftRef> {
  const row = await loadServerRow(serverId);
  if (!row) throw new Error("server not found");
  const db = getAdminMysqlDb();
  const version = nextVersionNumber(await loadVersionNumbers(serverId));
  const id = ulid();
  const now = new Date();
  await db.insert(mcpServerVersions).values({
    id,
    serverId,
    version,
    toolsJson: input.tools.map(toolToStoredJson),
    backendConfigJson: input.backendConfig,
    contentHash: surfaceContentHash(input.tools, input.backendConfig),
    shelfStatus: "draft",
    createdBy: input.createdBy ?? null,
    createdAt: now,
  });
  return { id, version, shelfStatus: "draft" };
}

async function loadOwnedVersion(serverId: string, versionId: string) {
  const row = await loadServerRow(serverId);
  if (!row) throw new Error("server not found");
  const db = getAdminMysqlDb();
  const versions = await db
    .select()
    .from(mcpServerVersions)
    .where(and(eq(mcpServerVersions.serverId, serverId), eq(mcpServerVersions.id, versionId)))
    .limit(1);
  return { server: row, version: versions[0] ?? null };
}

function openApiBackendType(stored: Record<string, unknown>): "openapi" | undefined {
  const plain = decryptBackendConfig(stored);
  return typeof plain.openapi_json === "string" && plain.openapi_json.trim() ? "openapi" : undefined;
}

export async function listMcpServerVersions(serverId: string): Promise<{
  publishedVersionId: string | null;
  versions: McpServerVersionSummary[];
}> {
  const row = await loadServerRow(serverId);
  if (!row) throw new Error("server not found");
  const db = getAdminMysqlDb();
  const versions = await db
    .select()
    .from(mcpServerVersions)
    .where(eq(mcpServerVersions.serverId, serverId))
    .orderBy(desc(mcpServerVersions.version));
  return {
    publishedVersionId: row.publishedVersionId ?? null,
    versions: versions.map((version) => ({
      id: version.id,
      version: version.version,
      shelfStatus: asShelf(version.shelfStatus),
      createdBy: version.createdBy ?? null,
      createdAt: isoTime(version.createdAt) ?? "",
      publishedAt: isoTime(version.publishedAt),
      toolCount: Array.isArray(version.toolsJson) ? version.toolsJson.length : 0,
    })),
  };
}

export async function publishCurrentMcpSurface(serverId: string, createdBy?: string): Promise<McpServerRecord> {
  const row = await loadServerRow(serverId);
  if (!row) throw new Error("server not found");
  assertCanPublishCurrent((await loadVersionNumbers(serverId)).length);
  const tools = recordsToVersionTools(await listMcpTools(serverId));
  const backend = (row.backendConfig as Record<string, unknown>) ?? {};
  const db = getAdminMysqlDb();
  const id = ulid();
  const now = new Date();
  await db.insert(mcpServerVersions).values({
    id,
    serverId,
    version: 1,
    toolsJson: tools.map(toolToStoredJson),
    backendConfigJson: backend,
    contentHash: surfaceContentHash(tools, backend),
    shelfStatus: "published",
    createdBy: createdBy ?? null,
    createdAt: now,
    publishedAt: now,
  });
  await db
    .update(mcpServers)
    .set({ publishedVersionId: id, updatedAt: now })
    .where(and(eq(mcpServers.tenantId, row.tenantId), eq(mcpServers.id, serverId)));
  const updated = await getMcpServer(serverId);
  if (!updated) throw new Error("server not found");
  return updated;
}

export async function publishMcpServerVersion(serverId: string, versionId: string): Promise<McpServerRecord> {
  const { server, version } = await loadOwnedVersion(serverId, versionId);
  if (!version) throw new Error("version not found");
  assertCanPublishDraft(asShelf(version.shelfStatus));
  const tools = Array.isArray(version.toolsJson) ? version.toolsJson.map(storedJsonToTool) : [];
  const backend =
    version.backendConfigJson && typeof version.backendConfigJson === "object" && !Array.isArray(version.backendConfigJson)
      ? version.backendConfigJson
      : {};
  const db = getAdminMysqlDb();
  const now = new Date();
  await db
    .update(mcpServerVersions)
    .set({ shelfStatus: "published", publishedAt: now })
    .where(eq(mcpServerVersions.id, versionId));
  const patch: Partial<typeof mcpServers.$inferInsert> = {
    publishedVersionId: versionId,
    backendConfig: backend,
    updatedAt: now,
  };
  const backendType = openApiBackendType(backend);
  if (backendType) patch.backendType = backendType;
  await db
    .update(mcpServers)
    .set(patch)
    .where(and(eq(mcpServers.tenantId, server.tenantId), eq(mcpServers.id, serverId)));
  await writeLiveTools(serverId, versionToolsToRecords(tools));
  const updated = await getMcpServer(serverId);
  if (!updated) throw new Error("server not found");
  return updated;
}

export async function rollbackMcpServerVersion(serverId: string, versionId: string): Promise<McpServerRecord> {
  const { server, version } = await loadOwnedVersion(serverId, versionId);
  if (!version) throw new Error("version not found");
  assertCanRollback(asShelf(version.shelfStatus), versionId === server.publishedVersionId);
  const tools = Array.isArray(version.toolsJson) ? version.toolsJson.map(storedJsonToTool) : [];
  const backend =
    version.backendConfigJson && typeof version.backendConfigJson === "object" && !Array.isArray(version.backendConfigJson)
      ? version.backendConfigJson
      : {};
  const db = getAdminMysqlDb();
  const now = new Date();
  const patch: Partial<typeof mcpServers.$inferInsert> = {
    publishedVersionId: versionId,
    backendConfig: backend,
    updatedAt: now,
  };
  const backendType = openApiBackendType(backend);
  if (backendType) patch.backendType = backendType;
  await db
    .update(mcpServers)
    .set(patch)
    .where(and(eq(mcpServers.tenantId, server.tenantId), eq(mcpServers.id, serverId)));
  await writeLiveTools(serverId, versionToolsToRecords(tools));
  const updated = await getMcpServer(serverId);
  if (!updated) throw new Error("server not found");
  return updated;
}

/** Parse OpenAPI JSON and return candidate operations for admin whitelist UI. */
export function previewOpenAPIOperations(
  specJson: string
): Array<{ operationId: string; summary: string; method: string; path: string; operation: Record<string, unknown> }> {
  const doc = JSON.parse(specJson) as Record<string, unknown>;
  const paths = (doc.paths ?? {}) as Record<string, Record<string, unknown>>;
  const out: Array<{ operationId: string; summary: string; method: string; path: string; operation: Record<string, unknown> }> = [];
  for (const [path, methods] of Object.entries(paths)) {
    for (const [method, opAny] of Object.entries(methods)) {
      if (method.startsWith("x-")) continue;
      const op = opAny as Record<string, unknown>;
      if (op["x-mcp-disabled"] === true) continue;
      const operationId = String(op.operationId ?? `${method}_${path}`);
      out.push({
        operationId,
        summary: String(op.summary ?? op.description ?? ""),
        method: method.toUpperCase(),
        path,
        operation: op,
      });
    }
  }
  return out;
}

function buildToolInputSchema(op: Record<string, unknown>): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const required: string[] = [];
  const params = Array.isArray(op.parameters) ? op.parameters : [];
  for (const pAny of params) {
    const p = pAny as Record<string, unknown>;
    const name = String(p.name ?? "");
    if (!name) continue;
    props[name] = (p.schema as Record<string, unknown>) ?? { type: "string" };
    if (p.required === true) required.push(name);
  }
  const rb = op.requestBody as Record<string, unknown> | undefined;
  const content = rb?.content as Record<string, Record<string, unknown>> | undefined;
  const jsonBody = content?.["application/json"]?.schema as Record<string, unknown> | undefined;
  if (jsonBody) {
    props.body = jsonBody;
    if (rb?.required === true) required.push("body");
  }
  const schema: Record<string, unknown> = { type: "object", properties: props };
  if (required.length > 0) schema.required = required;
  return schema;
}

export interface McpDraftRef {
  id: string;
  version: number;
  shelfStatus: "draft";
}

export async function importOpenAPITools(
  serverId: string,
  specJson: string,
  allowedOperationIds: string[],
  baseUrl?: string,
  createdBy?: string,
): Promise<{ server: McpServerRecord; draft: McpDraftRef | null }> {
  const server = await getMcpServer(serverId);
  if (!server) throw new Error("server not found");
  const allowed = new Set(allowedOperationIds.map((s) => s.trim()).filter(Boolean));
  const preview = previewOpenAPIOperations(specJson);
  const tools: Omit<McpToolRecord, "id" | "serverId">[] = [];
  for (const op of preview) {
    if (!allowed.has(op.operationId)) continue;
    tools.push({
      toolName: op.operationId,
      description: op.summary || `${op.method} ${op.path}`,
      inputSchema: buildToolInputSchema(op.operation),
      enabled: true,
      sourceOperationId: op.operationId,
      metadata: { method: op.method, path: op.path },
    });
  }
  const backendConfig = {
    ...server.backendConfig,
    openapi_json: specJson,
    allowed_operation_ids: [...allowed],
    ...(baseUrl?.trim() ? { base_url: baseUrl.trim() } : {}),
  };
  if (!(await isServerVersionManaged(serverId))) {
    await updateMcpServer(serverId, { backendConfig, backendType: "openapi" });
    await writeLiveTools(serverId, tools);
    const updated = await getMcpServer(serverId);
    if (!updated) throw new Error("update failed");
    return { server: updated, draft: null };
  }
  const draft = await insertToolSurfaceDraft(serverId, {
    tools: recordsToVersionTools(tools),
    backendConfig: encryptBackendConfig(backendConfig),
    createdBy,
  });
  return { server, draft };
}
