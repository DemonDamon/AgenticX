/**
 * admin-console · 连接器网关管理（经网关 /internal/connectors REST，OpenAPI 导入
 * 与凭据加密都在网关 Go 侧单源实现；本层只做转发与租户解析）。
 */

import { requireGatewayInternalToken } from "./gateway-internal-token";

const base = () => process.env.GATEWAY_INTERNAL_BASE_URL?.trim() || "http://127.0.0.1:8080";

function requiredTenantId(): string {
  const t = process.env.DEFAULT_TENANT_ID?.trim();
  if (!t) throw new Error("DEFAULT_TENANT_ID is required for connector gateway management.");
  return t;
}

function authHeaders(extra?: Record<string, string>) {
  const t = requireGatewayInternalToken();
  return { Authorization: `Bearer ${t}`, "Content-Type": "application/json", ...extra };
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${base().replace(/\/$/, "")}${path}`, {
    ...init,
    headers: authHeaders(),
    cache: "no-store",
  });
  const json = (await res.json().catch(() => ({}))) as {
    code?: string;
    message?: string;
    data?: T;
  };
  if (!res.ok || json.code !== "00000") {
    const err = new Error(json.message || `gateway call failed (${res.status})`) as Error & {
      status?: number;
      code?: string;
      data?: T;
    };
    err.status = res.status;
    err.code = json.code;
    err.data = json.data as T;
    throw err;
  }
  return (json.data ?? {}) as T;
}

export interface ConnectorSummary {
  id: string;
  displayName: string;
  description?: string;
  authType: string;
  actionCount: number;
}

export interface ConnectorImportResult {
  connector: ConnectorSummary & { baseUrl: string };
  destructive: string[];
}

export interface ConnectionRecord {
  id: string;
  connectorId: string;
  name: string;
  authType: string;
  grantedScopes: string[];
  status: string;
  createdAt: string;
}

export async function listConnectors(): Promise<ConnectorSummary[]> {
  const data = await call<{ connectors: ConnectorSummary[] }>(
    `/internal/connectors?tenant_id=${encodeURIComponent(requiredTenantId())}`
  );
  return data.connectors ?? [];
}

export async function importConnector(input: {
  connectorId: string;
  displayName?: string;
  baseUrl?: string;
  spec: unknown;
  confirmDestructive: boolean;
}): Promise<ConnectorImportResult> {
  return call<ConnectorImportResult>("/internal/connectors/import", {
    method: "POST",
    body: JSON.stringify({
      tenant_id: requiredTenantId(),
      connector_id: input.connectorId,
      display_name: input.displayName,
      base_url: input.baseUrl,
      spec: input.spec,
      confirm_destructive: input.confirmDestructive,
    }),
  });
}

export async function deleteConnector(connectorId: string): Promise<void> {
  await call(`/internal/connectors/${encodeURIComponent(connectorId)}?tenant_id=${encodeURIComponent(requiredTenantId())}`, {
    method: "DELETE",
  });
}

export async function listConnections(connectorId: string): Promise<ConnectionRecord[]> {
  const data = await call<{ connections: ConnectionRecord[] }>(
    `/internal/connectors/${encodeURIComponent(connectorId)}/connections?tenant_id=${encodeURIComponent(requiredTenantId())}`
  );
  return data.connections ?? [];
}

export async function createConnection(
  connectorId: string,
  input: { name: string; grantedScopes?: string[]; apiKey?: string }
): Promise<ConnectionRecord> {
  const data = await call<{ connection: ConnectionRecord }>(
    `/internal/connectors/${encodeURIComponent(connectorId)}/connections`,
    {
      method: "POST",
      body: JSON.stringify({
        tenant_id: requiredTenantId(),
        name: input.name,
        granted_scopes: input.grantedScopes ?? [],
        api_key: input.apiKey ?? "",
      }),
    }
  );
  return data.connection;
}

export async function rotateConnection(connectorId: string, connectionId: string, apiKey: string): Promise<void> {
  await call(
    `/internal/connectors/${encodeURIComponent(connectorId)}/connections/${encodeURIComponent(connectionId)}/rotate`,
    { method: "POST", body: JSON.stringify({ tenant_id: requiredTenantId(), api_key: apiKey }) }
  );
}

export async function revokeConnection(connectorId: string, connectionId: string): Promise<void> {
  await call(
    `/internal/connectors/${encodeURIComponent(connectorId)}/connections/${encodeURIComponent(connectionId)}/revoke`,
    { method: "POST", body: JSON.stringify({ tenant_id: requiredTenantId() }) }
  );
}
