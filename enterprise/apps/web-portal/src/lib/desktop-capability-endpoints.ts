/**
 * 给 MCP 能力补上 Desktop 实际要连的地址：网关的 `/v1/mcp/<server_id>/` 反代入口。
 *
 * 由服务端算而不是让 Desktop 自己拼：拼装规则一旦分散在客户端，网关换路径就得等
 * 所有员工升级客户端。桌面端拿到什么就连什么，没给地址就是连不了。
 */

import { parseCapabilityId } from "@agenticx/config";

import type { PortalCapability } from "./capability-packs-reader";
import { resolveDesktopInferenceApiBase } from "./desktop-inference-base";

export function withGatewayMcpEndpoints(
  capabilities: readonly PortalCapability[],
  configured?: string,
  nodeEnv?: string,
): PortalCapability[] {
  const base = resolveDesktopInferenceApiBase({
    configured: configured ?? process.env.NEXT_PUBLIC_GATEWAY_PUBLIC_BASE_URL,
    nodeEnv,
  });
  // 网关地址没配好时不编一个出来：给了错地址，客户端会反复重试一个连不上的端点。
  if (!base.ok) return [...capabilities];
  return capabilities.map((capability) => {
    if (capability.kind !== "mcp") return capability;
    const parsed = parseCapabilityId(capability.id);
    if (!parsed) return capability;
    return { ...capability, endpointUrl: `${base.url}/mcp/${parsed.rowId}/` };
  });
}
