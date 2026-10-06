/**
 * 连接器网关(open-connector)市场条目元数据。
 * 一条 streamable-http MCP 配置背后是上游网关聚合的服务/动作供给;
 * 安装=写入单条 MCP server 配置,不经市场上游。
 * 文案走 marketplace 命名空间 i18n(key 前缀 gateway.*),这里只放结构化数据与双形态默认值。
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
  /** 托管服务默认端点(托管形态一键安装用)。 */
  hostedUrl: "https://connector.oomol.com/mcp",
  /** 官方仓库外链(详情与文档入口)。 */
  officialUrl: "https://github.com/oomol-lab/open-connector",
  /** 供给规模(卡片与弹层展示,i18n 插值取整约数)。 */
  supply: { providers: 1579, actions: 11464 },
} as const;

/** 托管形态默认表单(一键安装,自建形态由用户覆盖 url/token)。 */
export function defaultGatewayForm(): GatewayForm {
  return {
    mode: "hosted",
    url: CONNECTOR_GATEWAY.hostedUrl,
    token: "",
    serverName: CONNECTOR_GATEWAY.serverName,
  };
}
