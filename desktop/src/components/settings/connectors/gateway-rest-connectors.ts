/**
 * 本机连接器网关里「对话新建」的 REST 连接器（origin=user）。
 * 只读投影：id / 名称 / baseUrl / 鉴权类型 / 是否已有凭证；不含任何密钥。
 * 数据经主进程 admin 代理（admin token 只留主进程）。
 */

import { useCallback, useEffect, useState } from "react";

export type GatewayRestConnector = {
  id: string;
  name: string;
  description?: string;
  baseUrl?: string;
  authType?: string;
  actionCount?: number;
  hasCredential: boolean;
};

type AdminFn = (payload: { method: string; path: string; body?: unknown }) => Promise<{
  ok: boolean;
  status: number;
  body?: unknown;
  error?: string;
}>;

function adminFn(): AdminFn | undefined {
  const api = (globalThis as { window?: { agenticxDesktop?: { connectorRuntimeAdmin?: AdminFn } } }).window
    ?.agenticxDesktop;
  return api?.connectorRuntimeAdmin;
}

/** 纯函数：/admin/connectors + /admin/connections 响应 → 用户 REST 连接器列表。 */
export function projectGatewayRestConnectors(appsBody: unknown, connsBody: unknown): GatewayRestConnector[] {
  const apps = (appsBody as { apps?: unknown })?.apps;
  const conns = (connsBody as { connections?: unknown })?.connections;
  const withCred = new Set<string>();
  if (Array.isArray(conns)) {
    for (const c of conns) {
      const cid = (c as { connectorId?: unknown })?.connectorId;
      if (typeof cid === "string" && cid) withCred.add(cid);
    }
  }
  const out: GatewayRestConnector[] = [];
  if (!Array.isArray(apps)) return out;
  for (const raw of apps) {
    const a = raw as Record<string, unknown>;
    if (a?.origin !== "user" || typeof a.id !== "string" || !a.id) continue;
    const authType = typeof a.authType === "string" ? a.authType : undefined;
    out.push({
      id: a.id,
      name: typeof a.displayName === "string" && a.displayName.trim() ? a.displayName.trim() : a.id,
      ...(typeof a.description === "string" && a.description.trim() ? { description: a.description.trim() } : {}),
      ...(typeof a.baseUrl === "string" && a.baseUrl ? { baseUrl: a.baseUrl } : {}),
      ...(authType ? { authType } : {}),
      ...(typeof a.actionCount === "number" ? { actionCount: a.actionCount } : {}),
      hasCredential: authType === "none" || withCred.has(a.id),
    });
  }
  return out;
}

export async function fetchGatewayRestConnectors(): Promise<GatewayRestConnector[]> {
  const admin = adminFn();
  if (!admin) return [];
  const apps = await admin({ method: "GET", path: "/admin/connectors" });
  if (!apps.ok) return [];
  const conns = await admin({ method: "GET", path: "/admin/connections" });
  return projectGatewayRestConnectors(apps.body, conns.ok ? conns.body : undefined);
}

/** 注销 REST 连接器（网关级联删除其凭证连接）。 */
export async function deleteGatewayRestConnector(id: string): Promise<{ ok: boolean; error?: string }> {
  const admin = adminFn();
  if (!admin) return { ok: false, error: "connector runtime unavailable" };
  const res = await admin({ method: "DELETE", path: `/admin/connectors/${encodeURIComponent(id)}` });
  if (res.ok || res.status === 404) return { ok: true };
  const err = (res.body as { error?: unknown })?.error;
  return { ok: false, error: typeof err === "string" ? err : res.error || `HTTP ${res.status}` };
}

/**
 * 网关已装（mcp.json 有网关条目）时拉取用户 REST 连接器；未装则不拉起 sidecar。
 * refreshKey 变化时重新拉取。
 */
export function useGatewayRestConnectors(enabled: boolean, refreshKey: unknown = 0): {
  connectors: GatewayRestConnector[];
  reload: () => void;
} {
  const [connectors, setConnectors] = useState<GatewayRestConnector[]>([]);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!enabled) {
      setConnectors([]);
      return;
    }
    let cancelled = false;
    fetchGatewayRestConnectors()
      .then((list) => {
        if (!cancelled) setConnectors(list);
      })
      .catch(() => {
        /* best-effort */
      });
    return () => {
      cancelled = true;
    };
  }, [enabled, refreshKey, tick]);
  return { connectors, reload };
}
