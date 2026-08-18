/**
 * 给 MCP 能力补上 Desktop 实际要连的地址。
 *
 * 网关上有两套 MCP：`/v1/mcp/<id>/` 是反代（mcp_proxy_servers 表），
 * `/mcp/<name>/streamable-http` 是托管（mcp_servers 表）。能力包引用的是后者，
 * 所以这里只能给托管那条路径——给错了就是一个连不上的 404。
 *
 * 由服务端算而不是让 Desktop 自己拼：拼装规则一旦分散在客户端，网关换路径就得等
 * 所有员工升级客户端。桌面端拿到什么就连什么，没给地址就是连不了。
 *
 * 路径里用的是 name 而不是 ULID，因为托管路由本身就是按 name 定的。管理员改名后
 * 员工下次同步会拿到新地址；能力 id 仍然是 ULID，分配与用量归属不受改名影响。
 */

import type { PortalCapability } from "./capability-packs-reader";
import { resolveDesktopInferenceApiBase } from "./desktop-inference-base";

/** 从推理基址回推网关根：两者同源，复用同一份 env 校验（生产强制 https）。 */
function gatewayRootFrom(configured?: string, nodeEnv?: string): string | null {
  const base = resolveDesktopInferenceApiBase({
    configured: configured ?? process.env.NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL,
    nodeEnv,
  });
  if (!base.ok) return null;
  return base.url.replace(/\/v1$/, "");
}

export function hostedMcpEndpoint(root: string, serverName: string): string {
  return `${root}/mcp/${encodeURIComponent(serverName)}/streamable-http`;
}

export function withGatewayMcpEndpoints(
  capabilities: readonly PortalCapability[],
  configured?: string,
  nodeEnv?: string,
): PortalCapability[] {
  const root = gatewayRootFrom(configured, nodeEnv);
  // 网关地址没配好时不编一个出来：给了错地址，客户端会反复重试一个连不上的端点。
  if (!root) return [...capabilities];
  return capabilities.map((capability) => {
    if (capability.kind !== "mcp" || !capability.name) return capability;
    return { ...capability, endpointUrl: hostedMcpEndpoint(root, capability.name) };
  });
}
