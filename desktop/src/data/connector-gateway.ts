/**
 * 连接器网关市场条目元数据。
 * 内置形态背后是随桌面分发的本地网关 sidecar(精选连接器供给);
 * 安装=写入单条 MCP server 配置,不经市场上游。
 * 文案走 marketplace 命名空间 i18n(key 前缀 gateway.*),这里只放结构化数据。
 */

import {
  GATEWAY_DEFAULT_SERVER_NAME,
  GATEWAY_MARKET_SERVER_ID,
  type GatewayForm,
} from "../components/marketplace/gateway-model";

export const CONNECTOR_GATEWAY = {
  /** 市场精选卡 serverId 特例标记(安装走网关弹层)。 */
  marketServerId: GATEWAY_MARKET_SERVER_ID,
  /** 写入 mcp.json 的默认 server 名。 */
  serverName: GATEWAY_DEFAULT_SERVER_NAME,
} as const;

/** 默认表单(内置形态;url/token 在安装时由 sidecar 就绪信息动态填充)。 */
export function defaultGatewayForm(): GatewayForm {
  return {
    mode: "builtin",
    url: "",
    token: "",
    serverName: CONNECTOR_GATEWAY.serverName,
  };
}
