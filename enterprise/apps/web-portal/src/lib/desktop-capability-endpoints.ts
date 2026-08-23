/**
 * 给 MCP 能力补上 Desktop 实际要连的地址。
 *
 * 能力包引用的是托管 MCP（按 name 路由），不是按 id 反代的那条。
 * 由服务端算而不是让 Desktop 自己拼：拼装规则一旦分散在客户端，网关换路径就得等
 * 所有员工升级客户端。
 */

import type { PortalCapability } from "./capability-packs-reader";

function gatewayRootFrom(configured?: string, nodeEnv?: string): string | null {
  const raw = String(
    configured ?? process.env.NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL ?? "",
  )
    .trim()
    .replace(/\/+$/, "");
  if (!raw) return null;
  const env = nodeEnv ?? process.env.NODE_ENV;
  try {
    const url = new URL(raw);
    if (env === "production" && url.protocol !== "https:") return null;
  } catch {
    return null;
  }
  return raw.replace(/\/v1$/, "");
}

export function hostedMcpEndpoint(root: string, serverName: string): string {
  return `${root.replace(/\/+$/, "")}/mcp/${encodeURIComponent(serverName)}/streamable-http`;
}

export function withGatewayMcpEndpoints(
  capabilities: readonly PortalCapability[],
  configured?: string,
  nodeEnv?: string,
): PortalCapability[] {
  const root = gatewayRootFrom(configured, nodeEnv);
  if (!root) return [...capabilities];
  return capabilities.map((capability) => {
    if (capability.kind !== "mcp" || !capability.name) return capability;
    return { ...capability, endpointUrl: hostedMcpEndpoint(root, capability.name) };
  });
}
