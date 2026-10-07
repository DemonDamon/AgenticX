/**
 * 连接器供给表（Task B）：统一声明 native | mcp | gateway 条目与握手类型。
 * 市场「连接器」Tab 与设置墙共用：始终展示全量目录；
 * wired=true 可走真实握手；wired=false 仅「暂未接线」说明（含将需何种 auth），不伪造已连接。
 *
 * auth（对齐计划 Task A / Comate 表单差异）:
 * - none：仅命名实例（如钉钉 CLI）
 * - api_key：单一 API Key 字段（如知识星球 / TAPD）
 * - custom_credential：Token 或 URL+Token（如轻流 Token）
 * - oauth2：设备码 / 浏览器授权（GitHub Device Flow 等）
 */

import gatewayIcon from "../../../assets/connectors/gateway.svg";
import amapIcon from "../../../assets/connectors/stubs/amap.png";
import asanaIcon from "../../../assets/connectors/stubs/asana.svg";
import baiduMapsIcon from "../../../assets/connectors/stubs/baidu-maps.png";
import cloudflareIcon from "../../../assets/connectors/stubs/cloudflare.svg";
import comeinIcon from "../../../assets/connectors/stubs/comein.png";
import dichanIcon from "../../../assets/connectors/stubs/dichan.png";
import dingtalkIcon from "../../../assets/connectors/stubs/dingtalk.png";
import esignIcon from "../../../assets/connectors/stubs/esign.png";
import gildataIcon from "../../../assets/connectors/stubs/gildata.png";
import giteeIcon from "../../../assets/connectors/stubs/gitee.svg";
import gitlabIcon from "../../../assets/connectors/stubs/gitlab.svg";
import kuaidi100Icon from "../../../assets/connectors/stubs/kuaidi100.png";
import lawstarIcon from "../../../assets/connectors/stubs/lawstar.png";
import linearIcon from "../../../assets/connectors/stubs/linear.svg";
import neocrmIcon from "../../../assets/connectors/stubs/neocrm.png";
import outlookIcon from "../../../assets/connectors/stubs/outlook.png";
import pkulawIcon from "../../../assets/connectors/stubs/pkulaw.png";
import qichachaIcon from "../../../assets/connectors/stubs/qichacha.png";
import qingflowIcon from "../../../assets/connectors/stubs/qingflow.png";
import tencentDocsIcon from "../../../assets/connectors/stubs/tencent-docs.png";
import tencentMapsIcon from "../../../assets/connectors/stubs/tencent-maps.png";
import tianyanchaIcon from "../../../assets/connectors/stubs/tianyancha.png";
import wpsIcon from "../../../assets/connectors/stubs/wps.png";
import yingmiIcon from "../../../assets/connectors/stubs/yingmi.png";
import zoomIcon from "../../../assets/connectors/stubs/zoom.svg";
import zsxqIcon from "../../../assets/connectors/stubs/zsxq.png";
import { CONNECTORS, type ConnectorId } from "./connector-catalog";
import { nativeConnectorAvailability } from "../../../../electron/native-connectors-core";

/** 与网关/计划对齐的四种握手。 */
export type ConnectorAuthType = "none" | "api_key" | "custom_credential" | "oauth2";

export type ConnectorSupplyKind = "native" | "mcp" | "gateway";

/** 目录分类（Comate 风格骨架，仅展示用）。 */
export type ConnectorCatalogCategory =
  | "office"
  | "collab"
  | "code"
  | "maps"
  | "crm"
  | "docs"
  | "meeting"
  | "legal"
  | "data"
  | "finance"
  | "infra"
  | "gateway";

export type ConnectorSupplyEntry = {
  id: string;
  kind: ConnectorSupplyKind;
  /** 原生目录 id；kind=native 时必填。 */
  connectorId?: ConnectorId;
  auth: ConnectorAuthType;
  /** 本机是否已有真实接线路径（CLI / 安装弹层 / 网关）。 */
  wired: boolean;
  /** i18n key 后缀或固定展示名；市场层用 settings.connectors.catalog.* 或 marketplace.gateway。 */
  nameKey?: string;
  /** 静态中文名兜底（测试与无 i18n 场景）。 */
  fallbackName: string;
  fallbackDescription: string;
  iconSrc?: string;
  category?: ConnectorCatalogCategory;
  /**
   * 未接线时说明层展示的凭据提示（不落库、不伪造连接）。
   * 例：name_only / api_key / token / oauth_device
   */
  authFormHint?: "name_only" | "api_key" | "token" | "oauth_device" | "url_token";
};

/** 原生握手对照（实施时对照表，不整表伪造 SaaS）。 */
const NATIVE_AUTH: Partial<Record<ConnectorId, ConnectorAuthType>> = {
  "tencent-meeting": "oauth2",
  tapd: "api_key",
  github: "oauth2",
  feishu: "oauth2",
  wecom: "none",
  qqmail: "oauth2",
  gmail: "oauth2",
  notion: "oauth2",
  slack: "oauth2",
  gdrive: "oauth2",
  airtable: "api_key",
  supabase: "api_key",
  bigquery: "oauth2",
};

const NATIVE_CATEGORY: Partial<Record<ConnectorId, ConnectorCatalogCategory>> = {
  "tencent-meeting": "meeting",
  tapd: "collab",
  github: "code",
  feishu: "collab",
  wecom: "collab",
  qqmail: "office",
  gmail: "office",
  notion: "docs",
  slack: "collab",
  gdrive: "docs",
  airtable: "data",
  supabase: "data",
  bigquery: "data",
};

const NATIVE_AUTH_HINT: Partial<Record<ConnectorId, ConnectorSupplyEntry["authFormHint"]>> = {
  "tencent-meeting": "oauth_device",
  tapd: "api_key",
  github: "oauth_device",
  feishu: "oauth_device",
  wecom: "name_only",
  qqmail: "oauth_device",
  gmail: "oauth_device",
  notion: "oauth_device",
  slack: "oauth_device",
  gdrive: "oauth_device",
  airtable: "api_key",
  supabase: "api_key",
  bigquery: "oauth_device",
};

/** 网关精选供给（安装走 GatewayInstallModal）。 */
export const GATEWAY_SUPPLY_ID = "gateway:connector-runtime";

function nativeEntries(): ConnectorSupplyEntry[] {
  return CONNECTORS.map((c) => {
    const wired = nativeConnectorAvailability(c.id) === "available";
    const auth = NATIVE_AUTH[c.id] ?? "custom_credential";
    return {
      id: `native:${c.id}`,
      kind: "native" as const,
      connectorId: c.id,
      auth,
      wired,
      fallbackName: c.name,
      fallbackDescription: c.description,
      iconSrc: c.iconSrc,
      category: NATIVE_CATEGORY[c.id] ?? "collab",
      authFormHint: NATIVE_AUTH_HINT[c.id] ?? (auth === "none" ? "name_only" : auth === "api_key" ? "api_key" : auth === "oauth2" ? "oauth_device" : "token"),
    };
  });
}

/**
 * Comate 风格目录骨架：未接线 stub，仅展示名/图标/auth 元数据。
 * 禁止伪造「已连接」；接线需后续真实 MCP/原生路径。
 */
const CATALOG_STUBS: readonly ConnectorSupplyEntry[] = [
  // —— Comate 金融 / 投研 MCP ——
  {
    id: "stub:gildata",
    kind: "mcp",
    auth: "custom_credential",
    wired: false,
    fallbackName: "恒生聚源MCP",
    fallbackDescription: "恒生聚源金融数据 MCP：面向 AI 的专业金融取数服务，支持自然语言查询股票、基金、宏观指标等，把投研数据接到对话里。",
    iconSrc: gildataIcon,
    category: "finance",
    authFormHint: "token",
  },
  {
    id: "stub:yingmi",
    kind: "mcp",
    auth: "custom_credential",
    wired: false,
    fallbackName: "盈米MCP",
    fallbackDescription: "盈米 MCP 对接基金投顾与资产配置能力，汇聚基金产品、组合、持仓与行情等财富数据，便于助手完成投顾问答与组合分析。",
    iconSrc: yingmiIcon,
    category: "finance",
    authFormHint: "token",
  },
  {
    id: "stub:comein",
    kind: "mcp",
    auth: "custom_credential",
    wired: false,
    fallbackName: "进门投研",
    fallbackDescription: "进门 MCP 覆盖券商研究所、上市公司与资管机构的公开路演内容，整合国内外资研报，方便在对话中检索与摘要。",
    iconSrc: comeinIcon,
    category: "finance",
    authFormHint: "token",
  },
  {
    id: "stub:dichan",
    kind: "mcp",
    auth: "api_key",
    wired: false,
    fallbackName: "深度智联",
    fallbackDescription: "把深度智联提供的房地产 AI 数据服务接入助手，使用经克而瑞授权的数据能力，支持楼盘、市场与投研类查询。",
    iconSrc: dichanIcon,
    category: "data",
    authFormHint: "api_key",
  },
  {
    id: "stub:kuaidi100",
    kind: "mcp",
    auth: "api_key",
    wired: false,
    fallbackName: "快递100",
    fallbackDescription: "快递100 通过其服务提供快递物流信息的查询与跟踪，覆盖国内外多家承运商，可在对话中查单号、轨迹与签收状态。",
    iconSrc: kuaidi100Icon,
    category: "office",
    authFormHint: "api_key",
  },
  {
    id: "stub:lawstar",
    kind: "mcp",
    auth: "api_key",
    wired: false,
    fallbackName: "法律之星",
    fallbackDescription: "法律之星通过 MCP 提供法律信息检索与数据服务，覆盖法规、案例与条文解读，便于助手完成法律检索与引用。",
    iconSrc: lawstarIcon,
    category: "legal",
    authFormHint: "api_key",
  },
  {
    id: "stub:esign",
    kind: "mcp",
    auth: "custom_credential",
    wired: false,
    fallbackName: "e签宝电子签名",
    fallbackDescription: "e签宝对接电子签名与合同签署数据，汇聚合同、签署任务、签署方、印章与存证，支持签署进度查询与合同管理。",
    iconSrc: esignIcon,
    category: "office",
    authFormHint: "token",
  },
  {
    id: "stub:pkulaw",
    kind: "mcp",
    auth: "api_key",
    wired: false,
    fallbackName: "北大法宝-检索法律法规",
    fallbackDescription: "北大法宝 MCP 为 AI 应用提供专业法律数据服务，覆盖法规与案例检索，便于在对话中引用权威条文与裁判文书。",
    iconSrc: pkulawIcon,
    category: "legal",
    authFormHint: "api_key",
  },
  {
    id: "stub:neocrm",
    kind: "mcp",
    auth: "custom_credential",
    wired: false,
    fallbackName: "销售易 CRM",
    fallbackDescription: "销售易 MCP 对接销售易 CRM，汇聚客户、线索、商机、联系人等销售数据，支持跟进记录查询与商机洞察。",
    iconSrc: neocrmIcon,
    category: "crm",
    authFormHint: "token",
  },
  // —— 办公 / 协作 / 地图等 Comate 常见项 ——
  {
    id: "stub:dingtalk",
    kind: "mcp",
    auth: "none",
    wired: false,
    fallbackName: "钉钉 CLI",
    fallbackDescription: "钉钉企业通讯与待办协作：接线后可命名实例并调用消息、日程等能力；本条目免凭据，仅需完成实例命名即可使用。",
    iconSrc: dingtalkIcon,
    category: "collab",
    authFormHint: "name_only",
  },
  {
    id: "stub:qingflow",
    kind: "mcp",
    auth: "custom_credential",
    wired: false,
    fallbackName: "轻流",
    fallbackDescription: "轻流低代码流程与数据表平台：把审批流、表单与业务数据接到助手；接线后需填写 Token，即可查询与触发流程。",
    iconSrc: qingflowIcon,
    category: "collab",
    authFormHint: "token",
  },
  {
    id: "stub:zsxq",
    kind: "mcp",
    auth: "api_key",
    wired: false,
    fallbackName: "知识星球",
    fallbackDescription: "知识星球内容检索与发布：在对话中搜索星球主题、精华与讨论；接线后需填写 api_key，完成授权即可读写内容。",
    iconSrc: zsxqIcon,
    category: "docs",
    authFormHint: "api_key",
  },
  {
    id: "stub:amap",
    kind: "mcp",
    auth: "api_key",
    wired: false,
    fallbackName: "高德地图",
    fallbackDescription: "高德地图位置服务：地理编码、路径规划、周边 POI 检索与路况查询，把出行与本地生活能力接到助手对话里。",
    iconSrc: amapIcon,
    category: "maps",
    authFormHint: "api_key",
  },
  {
    id: "stub:baidu-maps",
    kind: "mcp",
    auth: "api_key",
    wired: false,
    fallbackName: "百度地图",
    fallbackDescription: "百度地图位置服务：地点检索、路线规划、坐标转换与周边查询，便于助手完成导航类问题与地理信息检索。",
    iconSrc: baiduMapsIcon,
    category: "maps",
    authFormHint: "api_key",
  },
  {
    id: "stub:tencent-maps",
    kind: "mcp",
    auth: "api_key",
    wired: false,
    fallbackName: "腾讯地图",
    fallbackDescription: "腾讯地图位置服务：地理编码、路线规划与周边检索，把地点查找与出行规划能力接入助手，支持自然语言提问。",
    iconSrc: tencentMapsIcon,
    category: "maps",
    authFormHint: "api_key",
  },
  {
    id: "stub:tencent-docs",
    kind: "mcp",
    auth: "custom_credential",
    wired: false,
    fallbackName: "腾讯文档",
    fallbackDescription: "腾讯文档在线文档、表格与幻灯片协作；可粘贴官方 MCP 端点与 Token，在对话中读写文档内容与协作信息。",
    iconSrc: tencentDocsIcon,
    category: "docs",
    authFormHint: "token",
  },
  {
    id: "stub:wps",
    kind: "mcp",
    auth: "custom_credential",
    wired: false,
    fallbackName: "WPS Office",
    fallbackDescription: "WPS Office 文档协作与项目管理：对接云文档、表格与团队空间；可粘贴官方 MCP 端点与 Token 后在对话中调用。",
    iconSrc: wpsIcon,
    category: "office",
    authFormHint: "token",
  },
  {
    id: "stub:outlook",
    kind: "mcp",
    auth: "custom_credential",
    wired: false,
    fallbackName: "Outlook",
    fallbackDescription: "微软 Outlook 邮件、日程与联系人协同：收发邮件、查询日历与管理联系人，把办公通讯能力接到助手工作流。",
    iconSrc: outlookIcon,
    category: "office",
    authFormHint: "token",
  },
  {
    id: "stub:zoom",
    kind: "mcp",
    auth: "oauth2",
    wired: false,
    fallbackName: "Zoom",
    fallbackDescription: "Zoom 会议、聊天与白板协作：创建与管理会议、查询录制与聊天记录，把远程会议能力接入助手，便于会前会后自动化。",
    iconSrc: zoomIcon,
    category: "meeting",
    authFormHint: "oauth_device",
  },
  {
    id: "stub:gitlab",
    kind: "mcp",
    auth: "custom_credential",
    wired: false,
    fallbackName: "GitLab",
    fallbackDescription: "GitLab 代码托管与 DevOps：查看仓库、合并请求、Issue 与 CI/CD 流水线，在对话中跟进变更与构建状态。",
    iconSrc: gitlabIcon,
    category: "code",
    authFormHint: "token",
  },
  {
    id: "stub:gitee",
    kind: "mcp",
    auth: "custom_credential",
    wired: false,
    fallbackName: "Gitee",
    fallbackDescription: "Gitee 代码托管与团队协作：管理仓库、Pull Request、Issue 与项目看板，把国内代码协作流程接到助手对话。",
    iconSrc: giteeIcon,
    category: "code",
    authFormHint: "token",
  },
  {
    id: "stub:linear",
    kind: "mcp",
    auth: "api_key",
    wired: false,
    fallbackName: "Linear",
    fallbackDescription: "Linear Issue 追踪与项目管理：查看与更新 Issue、周期与项目状态，适合工程团队在对话中推进研发任务。",
    iconSrc: linearIcon,
    category: "collab",
    authFormHint: "api_key",
  },
  {
    id: "stub:asana",
    kind: "mcp",
    auth: "oauth2",
    wired: false,
    fallbackName: "Asana",
    fallbackDescription: "Asana 任务与项目协作：管理项目、任务分配与进度跟踪，把团队待办与里程碑同步到助手，便于催办与汇总。",
    iconSrc: asanaIcon,
    category: "collab",
    authFormHint: "oauth_device",
  },
  {
    id: "stub:tianyancha",
    kind: "mcp",
    auth: "api_key",
    wired: false,
    fallbackName: "天眼查",
    fallbackDescription: "天眼查企业工商与法律风险信息：查询企业基本信息、股东、司法风险与经营状态，辅助尽职调查与客户背调。",
    iconSrc: tianyanchaIcon,
    category: "crm",
    authFormHint: "api_key",
  },
  {
    id: "stub:qichacha",
    kind: "mcp",
    auth: "api_key",
    wired: false,
    fallbackName: "企查查",
    fallbackDescription: "企查查企业与知识产权查询：工商信息、专利商标、诉讼与关联企业检索，便于在对话中完成企业尽调与核验。",
    iconSrc: qichachaIcon,
    category: "crm",
    authFormHint: "api_key",
  },
  {
    id: "stub:cloudflare",
    kind: "mcp",
    auth: "custom_credential",
    wired: false,
    fallbackName: "Cloudflare",
    fallbackDescription: "Cloudflare DNS 与边缘网络 API：管理域名解析、CDN 与安全规则，把边缘基础设施运维能力接入助手自动化。",
    iconSrc: cloudflareIcon,
    category: "infra",
    authFormHint: "token",
  },
];

export const CONNECTOR_SUPPLY: readonly ConnectorSupplyEntry[] = [
  {
    id: GATEWAY_SUPPLY_ID,
    kind: "gateway",
    auth: "none",
    wired: true,
    fallbackName: "连接器网关",
    fallbackDescription: "精选连接器目录：在对话中搜索并调用动作；各服务凭据留在网关侧，本地只下发指令并取回结果。",
    iconSrc: gatewayIcon,
    category: "gateway",
    authFormHint: "name_only",
  },
  ...nativeEntries(),
  ...CATALOG_STUBS,
];

/** 已接线供给（可握手）。 */
export function listWiredSupply(
  supply: readonly ConnectorSupplyEntry[] = CONNECTOR_SUPPLY,
): ConnectorSupplyEntry[] {
  return supply.filter((e) => e.wired);
}

/** 尚未接入（有目录占位但无真实路径）。 */
export function listUnwiredSupply(
  supply: readonly ConnectorSupplyEntry[] = CONNECTOR_SUPPLY,
): ConnectorSupplyEntry[] {
  return supply.filter((e) => !e.wired);
}

/** 市场目录：始终返回全量（wired + unwired），不再折叠。 */
export function listCatalogSupply(
  supply: readonly ConnectorSupplyEntry[] = CONNECTOR_SUPPLY,
): ConnectorSupplyEntry[] {
  return [...supply];
}

export function findSupplyById(
  id: string,
  supply: readonly ConnectorSupplyEntry[] = CONNECTOR_SUPPLY,
): ConnectorSupplyEntry | undefined {
  return supply.find((e) => e.id === id);
}

/**
 * 将 auth 映射为「新建连接器」表单字段。
 * 未接线 stub 写入 mcp.json 时需要 MCP URL：none 也带 url（无密钥）；
 * oauth2 stub 不走此表单（仍用暂未接线说明 / 原生握手）。
 */
export function authFormFields(auth: ConnectorAuthType): ReadonlyArray<"name" | "api_key" | "token" | "url"> {
  switch (auth) {
    case "none":
      return ["name", "url"];
    case "api_key":
      return ["name", "url", "api_key"];
    case "custom_credential":
      return ["name", "url", "token"];
    case "oauth2":
      return ["name"];
    default:
      return ["name"];
  }
}

/** 是否可用 Comate 风格新建表单（相对 oauth2 设备流 / 暂未接线说明）。 */
export function supportsCreateConnectorForm(auth: ConnectorAuthType | undefined): boolean {
  return auth === "none" || auth === "api_key" || auth === "custom_credential";
}
