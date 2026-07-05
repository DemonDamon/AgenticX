import { studioFetch } from "../../../utils/studio-fetch";
import type { DataSourceInfo } from "./types";

type RawStatusItem = {
  name: string;
  display_name: string;
  domain: string;
  requires_credential: boolean;
  status: DataSourceInfo["status"];
  enabled: boolean;
  stub_only?: boolean;
  mcp_server?: string;
  mcp_connected?: boolean;
  apis?: { name: string; description: string }[];
};

function mapItem(raw: RawStatusItem): DataSourceInfo {
  return {
    name: raw.name,
    displayName: raw.display_name,
    domain: raw.domain,
    requiresCredential: raw.requires_credential,
    status: raw.status,
    enabled: raw.enabled,
    stubOnly: raw.stub_only,
    mcpServer: raw.mcp_server,
    mcpConnected: raw.mcp_connected,
    apis: raw.apis,
  };
}

async function authHeaders(apiToken: string): Promise<HeadersInit> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const token = apiToken || (await window.agenticxDesktop.getApiAuthToken()) || "";
  if (token) headers["x-agx-desktop-token"] = token;
  return headers;
}

export async function fetchDataSourcesStatus(apiToken: string): Promise<DataSourceInfo[]> {
  const resp = await studioFetch("/api/data-sources/status", {
    apiToken,
    headers: await authHeaders(apiToken),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `HTTP ${resp.status}`);
  }
  const body = (await resp.json()) as { data_sources?: RawStatusItem[] };
  return (body.data_sources ?? []).map(mapItem);
}

export async function updateDataSourceConfig(
  apiToken: string,
  name: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const resp = await studioFetch("/api/data-sources/config", {
    method: "PUT",
    apiToken,
    headers: await authHeaders(apiToken),
    body: JSON.stringify({ name, patch }),
  });
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(text || `HTTP ${resp.status}`);
  }
}

export async function testDataSource(
  apiToken: string,
  name: string,
): Promise<{ ok: boolean; detail?: string }> {
  const resp = await studioFetch("/api/data-sources/test", {
    method: "POST",
    apiToken,
    headers: await authHeaders(apiToken),
    body: JSON.stringify({ name }),
  });
  if (resp.status === 404) {
    return { ok: false, detail: "数据源未启用或不存在" };
  }
  if (!resp.ok) {
    const text = await resp.text();
    return { ok: false, detail: text || `HTTP ${resp.status}` };
  }
  return (await resp.json()) as { ok: boolean; detail?: string };
}
