/**
 * admin-console · MCP upstream proxy 持久化（PG enterprise_runtime_mcp_servers）
 */

import { getAdminMysqlDb } from "./database";
import { enterpriseRuntimeMcpServers as mcpTable } from "@agenticx/db-schema/mysql";
import { eq } from "drizzle-orm";
import { ulid } from "ulid";

export interface McpProxyServer {
  id: string;
  name: string;
  upstreamUrl: string;
  /** Header line injected upstream, e.g. "Authorization: Bearer xxx" — never returned to clients. */
  authHeader?: string;
  enabled: boolean;
  toolRateLimit?: number;
}

export interface CreateMcpProxyServerInput {
  name: string;
  upstreamUrl: string;
  authHeader?: string;
  enabled?: boolean;
  toolRateLimit?: number;
}

export interface UpdateMcpProxyServerInput {
  name?: string;
  upstreamUrl?: string;
  authHeader?: string;
  enabled?: boolean;
  toolRateLimit?: number;
}

type ConfigBlob = { servers: McpProxyServer[] };

function requiredTenantId(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for MCP proxy persistence.");
  return t;
}

async function loadConfig(): Promise<ConfigBlob> {
  const db = getAdminMysqlDb();
  const tenantId = requiredTenantId();
  const rows = await db.select().from(mcpTable).where(eq(mcpTable.tenantId, tenantId)).limit(1);
  const row = rows[0];
  if (!row?.config || typeof row.config !== "object") {
    return { servers: [] };
  }
  const cfg = row.config as ConfigBlob;
  return { servers: Array.isArray(cfg.servers) ? cfg.servers : [] };
}

async function saveConfig(config: ConfigBlob): Promise<void> {
  const db = getAdminMysqlDb();
  const tenantId = requiredTenantId();
  const now = new Date();
  const existing = await db.select().from(mcpTable).where(eq(mcpTable.tenantId, tenantId)).limit(1);
  if (existing[0]) {
    await db
      .update(mcpTable)
      .set({ config, updatedAt: now })
      .where(eq(mcpTable.tenantId, tenantId));
    return;
  }
  await db.insert(mcpTable).values({
    tenantId,
    config,
    updatedAt: now,
  });
}

export async function listMcpProxyServers(): Promise<McpProxyServer[]> {
  const cfg = await loadConfig();
  return cfg.servers.map((s) => ({
    ...s,
    authHeader: s.authHeader ? "***" : undefined,
  }));
}

export async function listMcpProxyServersInternal(): Promise<McpProxyServer[]> {
  const cfg = await loadConfig();
  return cfg.servers;
}

export async function getMcpProxyServer(id: string): Promise<McpProxyServer | null> {
  const cfg = await loadConfig();
  const found = cfg.servers.find((s) => s.id === id);
  if (!found) return null;
  return { ...found, authHeader: found.authHeader ? "***" : undefined };
}

export async function createMcpProxyServer(input: CreateMcpProxyServerInput): Promise<McpProxyServer> {
  const name = input.name.trim();
  const upstreamUrl = input.upstreamUrl.trim();
  if (!name) throw new Error("name is required");
  if (!upstreamUrl) throw new Error("upstreamUrl is required");
  const cfg = await loadConfig();
  const id = ulid();
  const server: McpProxyServer = {
    id,
    name,
    upstreamUrl,
    authHeader: input.authHeader?.trim() || undefined,
    enabled: input.enabled ?? true,
    toolRateLimit: input.toolRateLimit,
  };
  cfg.servers.push(server);
  await saveConfig(cfg);
  return { ...server, authHeader: server.authHeader ? "***" : undefined };
}

export async function updateMcpProxyServer(id: string, input: UpdateMcpProxyServerInput): Promise<McpProxyServer> {
  const cfg = await loadConfig();
  const idx = cfg.servers.findIndex((s) => s.id === id);
  if (idx < 0) throw new Error("server not found");
  const cur = cfg.servers[idx]!;
  if (input.name !== undefined) cur.name = input.name.trim();
  if (input.upstreamUrl !== undefined) cur.upstreamUrl = input.upstreamUrl.trim();
  if (input.authHeader !== undefined) {
    const v = input.authHeader.trim();
    if (v && v !== "***") cur.authHeader = v;
  }
  if (input.enabled !== undefined) cur.enabled = input.enabled;
  if (input.toolRateLimit !== undefined) cur.toolRateLimit = input.toolRateLimit;
  cfg.servers[idx] = cur;
  await saveConfig(cfg);
  return { ...cur, authHeader: cur.authHeader ? "***" : undefined };
}

export async function deleteMcpProxyServer(id: string): Promise<void> {
  const cfg = await loadConfig();
  cfg.servers = cfg.servers.filter((s) => s.id !== id);
  await saveConfig(cfg);
}
