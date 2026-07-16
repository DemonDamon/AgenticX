/**
 * admin-console · MCP Server 持久化（PG）
 */

import { getAdminMysqlDb } from "./database";
import { mcpServers, mcpTools } from "@agenticx/db-schema/mysql";
import { and, desc, eq, sql } from "drizzle-orm";
import { ulid } from "ulid";

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
    backendConfig: (row.backendConfig as Record<string, unknown>) ?? {},
    requiredScopes: Array.isArray(row.requiredScopes) ? row.requiredScopes.map(String) : [],
    status: (row.status as McpServerStatus) || "active",
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
    backendConfig: input.backendConfig ?? {},
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
  const patch: Partial<typeof mcpServers.$inferInsert> = { updatedAt: new Date() };
  if (input.displayName !== undefined) patch.displayName = input.displayName;
  if (input.transport !== undefined) patch.transport = input.transport;
  if (input.backendType !== undefined) patch.backendType = input.backendType;
  if (input.backendConfig !== undefined) patch.backendConfig = input.backendConfig;
  if (input.requiredScopes !== undefined) patch.requiredScopes = input.requiredScopes;
  if (input.status !== undefined) patch.status = input.status;
  if (input.rateLimit !== undefined) patch.rateLimit = input.rateLimit;
  await db.update(mcpServers).set(patch).where(and(eq(mcpServers.tenantId, tenantId), eq(mcpServers.id, id)));
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

export async function importOpenAPITools(
  serverId: string,
  specJson: string,
  allowedOperationIds: string[],
  baseUrl?: string
): Promise<McpServerRecord> {
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
  await updateMcpServer(serverId, { backendConfig, backendType: "openapi" });
  await replaceMcpTools(serverId, tools);
  const updated = await getMcpServer(serverId);
  if (!updated) throw new Error("update failed");
  return updated;
}
