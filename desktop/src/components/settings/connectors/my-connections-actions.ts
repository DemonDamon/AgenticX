/**
 * 「我的连接」删除动作（市场与设置页共用一处实现）：
 * - native_logout：原生登出 + 摘掉折叠进来的 mcp.json 条目；
 * - mcp_remove：断开本会话 + 从 mcp.json 移除（含折叠的重复条目）；
 * - rest_remove：网关注销该 REST 连接器（级联删其凭证），网关条目不动；
 * - gateway_remove：移除网关 mcp.json 条目。
 */

import { MCP_PRIMARY_CONFIG_PATH } from "../../../utils/mcp-remote-config";
import type { ConnectorId } from "./connector-catalog";
import { deleteGatewayRestConnector } from "./gateway-rest-connectors";
import { removeMcpServerFromDocument, type MyConnectionRow } from "./my-connections-model";

export type ActionResult = { ok: boolean; error?: string };

async function logoutNative(connectorId: ConnectorId): Promise<ActionResult> {
  const api = window.agenticxDesktop;
  switch (connectorId) {
    case "tencent-meeting":
      return api.nativeConnectorTmeetLogout();
    case "github":
      return api.nativeConnectorGithubLogout();
    case "feishu":
      return api.nativeConnectorFeishuLogout();
    case "wecom":
      return api.nativeConnectorWecomLogout();
    case "qqmail":
      return api.nativeConnectorQqmailLogout();
    default:
      return { ok: false, error: `unsupported logout: ${connectorId}` };
  }
}

/** 本行折叠的全部 server 名（去重后一行可能对应多个历史重复条目）。 */
export function rowServerNames(row: MyConnectionRow): string[] {
  const names = row.mcpServerNames ?? [];
  const all = row.mcpServerName ? [row.mcpServerName, ...names] : names;
  return Array.from(new Set(all.filter(Boolean)));
}

export async function removeMcpServer(serverName: string): Promise<ActionResult> {
  const path = MCP_PRIMARY_CONFIG_PATH;
  const raw = await window.agenticxDesktop.mcpGetRaw({ path }).catch(() => null);
  if (!raw?.ok || typeof raw.text !== "string") {
    return { ok: false, error: raw?.error || "read mcp.json failed" };
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw.text) as Record<string, unknown>;
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  const { document, removed } = removeMcpServerFromDocument(parsed, serverName);
  if (!removed) return { ok: true };
  const save = await window.agenticxDesktop.mcpPutRaw({
    path,
    text: `${JSON.stringify(document, null, 2)}\n`,
  });
  if (!save?.ok) return { ok: false, error: save?.error || "write mcp.json failed" };
  return { ok: true };
}

export async function removeMcpServers(serverNames: readonly string[]): Promise<ActionResult> {
  for (const name of serverNames) {
    const res = await removeMcpServer(name);
    if (!res.ok) return res;
  }
  return { ok: true };
}

/** 删除 / 断开一行连接实例。 */
export async function deleteConnectionRow(row: MyConnectionRow, sessionId: string): Promise<ActionResult> {
  if (row.action === "native_logout" && row.connectorId) {
    const res = await logoutNative(row.connectorId);
    if (!res.ok) return res;
    // GitHub：原生登出后顺带摘掉 mcp.json 里的 github（及折叠进来的同模板条目），避免 SSOT 仍 degraded。
    await removeMcpServers(rowServerNames(row));
    return { ok: true };
  }
  if (row.action === "rest_remove" && row.restConnectorId) {
    return deleteGatewayRestConnector(row.restConnectorId);
  }
  if (row.action === "mcp_remove" && row.mcpServerName) {
    for (const name of rowServerNames(row)) {
      const disc = await window.agenticxDesktop.disconnectMcp({ sessionId, name });
      // 仅主条目断开失败才阻断；折叠的历史重复条目可能本就未连接。
      if (!disc.ok && name === row.mcpServerName) return { ok: false, error: disc.error };
    }
    return removeMcpServers(rowServerNames(row));
  }
  if (row.action === "gateway_remove" && row.mcpServerName) {
    return removeMcpServer(row.mcpServerName);
  }
  return { ok: false };
}
