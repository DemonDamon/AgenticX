import { requireGatewayInternalToken } from "./gateway-internal-token";

const base = () => process.env.GATEWAY_INTERNAL_BASE_URL?.trim() || "http://127.0.0.1:8080";

function authHeaders(extra?: Record<string, string>) {
  const t = requireGatewayInternalToken();
  return { Authorization: `Bearer ${t}`, ...extra };
}

export async function fetchGatewayPlugins() {
  const res = await fetch(`${base().replace(/\/$/, "")}/internal/plugins`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("fetch plugins failed");
  return res.json();
}

export async function reloadGatewayPlugins() {
  const res = await fetch(`${base().replace(/\/$/, "")}/internal/plugins/reload`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error("reload plugins failed");
  return res.json();
}

export async function fetchGatewayErrors(tenantId?: string) {
  const qs = tenantId ? `?tenant_id=${encodeURIComponent(tenantId)}` : "";
  const res = await fetch(`${base().replace(/\/$/, "")}/internal/errors${qs}`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("fetch errors failed");
  return res.json();
}

export async function fetchGatewayPerfConfig() {
  const res = await fetch(`${base().replace(/\/$/, "")}/internal/perf`, {
    headers: authHeaders(),
    cache: "no-store",
  });
  if (!res.ok) throw new Error("fetch perf config failed");
  return res.json();
}

export async function probeGatewayChannel(channelId: string) {
  const res = await fetch(`${base().replace(/\/$/, "")}/internal/channels/${channelId}/probe`, {
    method: "POST",
    headers: authHeaders(),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || "probe failed");
  }
  return res.json();
}
