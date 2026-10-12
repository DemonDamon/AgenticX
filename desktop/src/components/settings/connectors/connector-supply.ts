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
 * - mcp_oauth：官方远程 MCP 走 MCP OAuth 2.1（发现 + 动态客户端注册 + PKCE），表单只填名称；
 *   令牌由本机后端存于 ~/.agenticx/connectors/oauth/（0600），不经表单 / 模型 / 日志。
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
import wpsProjectIcon from "../../../assets/connectors/stubs/wps-project.png";
import qixinIcon from "../../../assets/connectors/stubs/qixin.png";
import mozlenIcon from "../../../assets/connectors/stubs/mozlen.png";
import tdxIcon from "../../../assets/connectors/stubs/tdx.png";
import mokaIcon from "../../../assets/connectors/stubs/moka.png";
import yuandianIcon from "../../../assets/connectors/stubs/yuandian.png";
import xiaoeIcon from "../../../assets/connectors/stubs/xiaoe.png";
import lexiangIcon from "../../../assets/connectors/stubs/lexiang.png";
import jinshujuIcon from "../../../assets/connectors/stubs/jinshuju.png";
import wkinfoIcon from "../../../assets/connectors/stubs/wkinfo.png";
import ifindIcon from "../../../assets/connectors/stubs/ifind.png";
import zhihuiyaIcon from "../../../assets/connectors/stubs/zhihuiya.png";
import wjIcon from "../../../assets/connectors/stubs/wj.png";
import cnbIcon from "../../../assets/connectors/stubs/cnb.png";
import gangtiseIcon from "../../../assets/connectors/stubs/gangtise.png";
import imaIcon from "../../../assets/connectors/stubs/ima.png";
import edgeoneIcon from "../../../assets/connectors/stubs/edgeone.png";
import fayanIcon from "../../../assets/connectors/stubs/fayan.png";
import { CONNECTORS, type ConnectorId } from "./connector-catalog";
import { nativeConnectorAvailability } from "../../../../electron/native-connectors-core";

/** 与网关/计划对齐的四种握手。 */
export type ConnectorAuthType = "none" | "api_key" | "custom_credential" | "oauth2" | "mcp_oauth";

export type ConnectorSupplyKind = "native" | "mcp" | "gateway";

/**
 * 连接市场来源分桶：官方 = Near 内置原生 + 官方模板目录；企业 = 企业连接器网关 / 企业下发目录。
 * 「推荐」不是来源，是 {@link ConnectorSupplyEntry.recommended} 精选标记。
 */
export type ConnectorMarketSource = "official" | "enterprise";

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

export type ConnectorAuthFormHint = "name_only" | "api_key" | "token" | "oauth_device" | "url_token" | "oauth_dcr";

/** Comate 多字段自定义头凭证（如 IMA apikey+clientid、Gangtise AK/SK）。 */
export type ConnectorCredentialField = {
  /** 写入 mcp.json headers 的头名（RFC 7230 token）。 */
  name: string;
  label: string;
  placeholder?: string;
  /** 缺省 password。 */
  inputType?: "password" | "text";
  /** 缺省 true。 */
  required?: boolean;
};

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
  authFormHint?: ConnectorAuthFormHint;
  /** 官方远程 MCP 端点（已核实）：新建表单预填并收进「高级」。 */
  mcpUrl?: string;
  /** API Key 走 URL 查询参数（如高德 `key`、百度 `ak`）而非 Authorization 头。 */
  apiKeyQuery?: string;
  /** 凭证写进自定义请求头（如盈米 `x-api-key`，原值不加 Bearer）；缺省 Authorization: Bearer。 */
  credentialHeader?: string;
  /** 官方接入文档。 */
  docsUrl?: string;
  /** 凭证字段标签（如「Access Token」）；缺省用通用 API Key / Token 文案。 */
  credentialLabel?: string;
  /** 凭证输入框占位（如「请填写恒生聚源下发的Access Token」）。 */
  credentialPlaceholder?: string;
  /** 「如何获取凭证 ↗」链接（系统浏览器打开）；缺省回退 docsUrl。 */
  credentialHelpUrl?: string;
  /**
   * 多字段自定义头凭证（Comate custom_header 多字段）。
   * 有值时新建表单渲染多输入框，写入 mcp.json 时每个 name → headers[name]；
   * 优先于单字段 credentialHeader / apiKey / token。
   */
  credentialFields?: readonly ConnectorCredentialField[];
  /** 连接市场来源分桶；缺省按 kind 推断（gateway → enterprise，其余 → official）。 */
  marketSource?: ConnectorMarketSource;
  /** 连接市场「推荐」精选（见 {@link RECOMMENDED_SUPPLY_IDS}）。 */
  recommended?: boolean;
};

/**
 * 连接市场「推荐」精选：已接线、常用的原生连接器 + 企业网关 + 少量高频模板。
 * 顺序即推荐位展示顺序。
 */
export const RECOMMENDED_SUPPLY_IDS: readonly string[] = [
  "gateway:connector-runtime",
  "native:feishu",
  "native:wecom",
  "native:github",
  "native:tencent-meeting",
  "native:qqmail",
  "native:tapd",
  "stub:dingtalk",
  "stub:tencent-docs",
  "stub:wps",
  "stub:amap",
];

/** 供给条目的市场来源（显式 marketSource 优先）。 */
export function connectorMarketSource(entry: Pick<ConnectorSupplyEntry, "kind" | "marketSource">): ConnectorMarketSource {
  if (entry.marketSource) return entry.marketSource;
  return entry.kind === "gateway" ? "enterprise" : "official";
}

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

/**
 * 原生目录里尚无本机握手、但官方提供远程 MCP（OAuth 2.1 + DCR）的条目：改走模板新建表单。
 * 去掉 connectorId，避免被当作原生握手 / 健康探活；id 不变（模板打标与 Python 镜像一致）。
 */
const NATIVE_REMOTE_MCP: Partial<Record<ConnectorId, Pick<ConnectorSupplyEntry, "mcpUrl" | "docsUrl">>> = {
  notion: {
    mcpUrl: "https://mcp.notion.com/mcp",
    docsUrl: "https://developers.notion.com/docs/mcp",
  },
};

function nativeEntries(): ConnectorSupplyEntry[] {
  return CONNECTORS.map((c) => {
    const remote = NATIVE_REMOTE_MCP[c.id];
    if (remote && nativeConnectorAvailability(c.id) !== "available") {
      return {
        id: `native:${c.id}`,
        kind: "mcp" as const,
        auth: "mcp_oauth" as const,
        wired: true,
        fallbackName: c.name,
        fallbackDescription: c.description,
        iconSrc: c.iconSrc,
        category: NATIVE_CATEGORY[c.id] ?? "collab",
        authFormHint: "oauth_dcr" as const,
        ...remote,
      };
    }
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
    auth: "api_key",
    wired: true,
    fallbackName: "恒生聚源MCP",
    fallbackDescription: "恒生聚源金融数据 MCP：面向 AI 的专业金融取数服务，支持自然语言查询股票、基金、宏观指标等，把投研数据接到对话里。",
    iconSrc: gildataIcon,
    category: "finance",
    authFormHint: "api_key",
    // WPS Comate: cred_type=query_param name=token；官方 Streamable。无 token → 401「认证凭证缺失或有误」。
    mcpUrl: "https://api.gildata.com/mcp-servers/aidata-assistant-srv-tool",
    apiKeyQuery: "token",
    docsUrl: "https://website.gildata.com/products/datamap",
    credentialLabel: "Access Token",
    credentialPlaceholder: "请填写恒生聚源下发的Access Token",
    credentialHelpUrl: "https://vcn7e7nesi3s.feishu.cn/docx/MeCmd4q0Yo7nmkx9D8IcMYbknob",
  },
  {
    id: "stub:yingmi",
    kind: "mcp",
    auth: "custom_credential",
    wired: true,
    fallbackName: "盈米MCP",
    fallbackDescription: "盈米 MCP 对接基金投顾与资产配置能力，汇聚基金产品、组合、持仓与行情等财富数据，便于助手完成投顾问答与组合分析。",
    iconSrc: yingmiIcon,
    category: "finance",
    authFormHint: "token",
    // WPS Comate: custom_header x-api-key，label APIKey。
    mcpUrl: "https://stargate.yingmi.com/mcp/v2",
    credentialHeader: "x-api-key",
    docsUrl: "https://ai.yingmi.com/mcp/account",
    credentialLabel: "APIKey",
    credentialPlaceholder: "登录盈米 MCP 开通服务后复制个人 API Key，粘贴到此处",
    credentialHelpUrl: "https://ai.yingmi.com/mcp/account",
  },
  {
    id: "stub:comein",
    kind: "mcp",
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "进门投研",
    fallbackDescription: "进门 MCP 覆盖券商研究所、上市公司与资管机构的公开路演内容，整合国内外资研报，方便在对话中检索与摘要。",
    iconSrc: comeinIcon,
    category: "finance",
    authFormHint: "oauth_dcr",
    // WPS Comate: user_oauth OAuth 2.1 DCR；无凭证字段，浏览器授权。
    mcpUrl: "https://mcp-server-global.comein.cn/mcp",
  },
  {
    id: "stub:dichan",
    kind: "mcp",
    auth: "api_key",
    wired: true,
    fallbackName: "深度智联",
    fallbackDescription: "把深度智联提供的房地产 AI 数据服务接入助手，使用经克而瑞授权的数据能力，支持楼盘、市场与投研类查询。",
    iconSrc: dichanIcon,
    category: "data",
    authFormHint: "api_key",
    // Probe 2026-10-08: POST /api/v1/mcp → 200「auth token required」；Comate bearer_token。
    mcpUrl: "https://mcp.dichanai.com/api/v1/mcp",
    docsUrl: "https://mcp.dichanai.com/profile/api-keys",
    credentialLabel: "API Key",
    credentialPlaceholder: "请输入API Key",
    credentialHelpUrl: "https://mcp.dichanai.com/profile/api-keys",
  },
  {
    id: "stub:kuaidi100",
    kind: "mcp",
    auth: "api_key",
    wired: true,
    fallbackName: "快递100",
    fallbackDescription: "快递100 通过其服务提供快递物流信息的查询与跟踪，覆盖国内外多家承运商，可在对话中查单号、轨迹与签收状态。",
    iconSrc: kuaidi100Icon,
    category: "office",
    authFormHint: "api_key",
    // 官方推荐 Streamable；授权 Key 走 `?key=`（错 Key → 工具返回「用户鉴权失败」）。
    mcpUrl: "https://api.kuaidi100.com/mcp/streamable",
    apiKeyQuery: "key",
    docsUrl: "https://api.kuaidi100.com/document/mcp-summary",
    // 与 WPS Comate 快递100 模板逐字一致。
    credentialLabel: "快递 100 授权 key",
    credentialPlaceholder: "请输入快递 100 授权 key",
    credentialHelpUrl: "https://api.kuaidi100.com/document/how-to-use-mcp-service",
  },
  {
    id: "stub:lawstar",
    kind: "mcp",
    auth: "api_key",
    wired: true,
    fallbackName: "法律之星",
    fallbackDescription: "法律之星通过 MCP 提供法律信息检索与数据服务，覆盖法规、案例与条文解读，便于助手完成法律检索与引用。",
    iconSrc: lawstarIcon,
    category: "legal",
    authFormHint: "api_key",
    // WPS Comate: bearer_token label「Token」；Authorization: Bearer。
    mcpUrl: "https://api.law-star.com/mcp/point",
    docsUrl: "https://open.law-star.com/products/mcp",
    credentialLabel: "Token",
    credentialPlaceholder: "输入 Token 值即可，无需填写 Bearer 前缀",
    credentialHelpUrl: "https://open.law-star.com/products/mcp",
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
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "北大法宝-检索法律法规",
    fallbackDescription: "北大法宝MCP服务平台为AI应用提供专业的法律数据服务。通过MCP协议，您可以让AI助手具备法律检索、条文查询等专业能力。",
    iconSrc: pkulawIcon,
    category: "legal",
    authFormHint: "oauth_dcr",
    // WPS Comate: user_oauth OAuth 2.1 DCR（PKCE 可留空 Client Secret）；表单仅名称 + DCR 提示。
    mcpUrl: "https://apim-gateway.pkulaw.com/mcp-law-search-service",
  },
  {
    id: "stub:neocrm",
    kind: "mcp",
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "销售易 CRM",
    fallbackDescription: "销售易 MCP 对接销售易 CRM，汇聚客户、线索、商机、联系人等销售数据，提供销售 AI Agent 查询与跟进所需的结构化业务信息。",
    iconSrc: neocrmIcon,
    category: "crm",
    authFormHint: "oauth_dcr",
    // WPS Comate: user_oauth OAuth 2.1 DCR；官方 MCP https://mcp.xiaoshouyi.com/mcp。
    mcpUrl: "https://mcp.xiaoshouyi.com/mcp",
  },
  // —— 办公 / 协作 / 地图等 Comate 常见项 ——
  {
    id: "stub:dingtalk",
    kind: "mcp",
    auth: "none",
    wired: false,
    fallbackName: "钉钉CLI",
    fallbackDescription: "钉钉企业通讯与待办协作：接线后可命名实例并调用消息、日程等能力；本条目免凭据，仅需完成实例命名即可使用。",
    iconSrc: dingtalkIcon,
    category: "collab",
    authFormHint: "name_only",
  },
  {
    id: "stub:qingflow",
    kind: "mcp",
    auth: "custom_credential",
    wired: true,
    fallbackName: "轻流",
    fallbackDescription: "轻流低代码流程与数据表平台：把审批流、表单与业务数据接到助手；接线后需填写 Token，即可查询与触发流程。",
    iconSrc: qingflowIcon,
    category: "collab",
    authFormHint: "token",
    // WPS Comate: bearer_token label「Token」placeholder「输入 Token 值」。
    mcpUrl: "https://mcp.qingflow.com/mcp",
    docsUrl: "https://qingflow.com/index/user?tab=baseInfo",
    credentialLabel: "Token",
    credentialPlaceholder: "输入 Token 值",
    credentialHelpUrl: "https://qingflow.com/index/user?tab=baseInfo",
  },
  {
    id: "stub:zsxq",
    kind: "mcp",
    auth: "api_key",
    wired: true,
    fallbackName: "知识星球",
    fallbackDescription: "知识星球内容检索与发布：在对话中搜索星球主题、精华与讨论；接线后需填写 api_key，完成授权即可读写内容。",
    iconSrc: zsxqIcon,
    category: "docs",
    authFormHint: "api_key",
    // WPS Comate: query_param api_key；探测到 https://api.zsxq.com/mcp（无 key → 401）。
    mcpUrl: "https://api.zsxq.com/mcp",
    apiKeyQuery: "api_key",
    docsUrl: "https://garden.zsxq.com/jasmine/index.html",
    credentialLabel: "api_key",
    credentialPlaceholder: "请输入你的api_key",
    credentialHelpUrl: "https://garden.zsxq.com/jasmine/index.html",
  },
  {
    id: "stub:amap",
    kind: "mcp",
    auth: "api_key",
    wired: true,
    fallbackName: "高德地图",
    fallbackDescription: "高德地图 MCP 服务，提供地理编码（地址转坐标）、逆地理编码（坐标转地址）、POI 关键字搜索、实时天气/天气预报查询、驾车路径规划等核心 LBS 能力。适用于位置查询、周边检索、出行路线规划、天气查询等场景。",
    iconSrc: amapIcon,
    category: "maps",
    authFormHint: "api_key",
    mcpUrl: "https://mcp.amap.com/mcp",
    apiKeyQuery: "key",
    docsUrl: "https://lbs.amap.com/api/mcp-server/create-project-and-key",
    credentialLabel: "高德地图密钥",
    credentialPlaceholder: "请输入高德地图密钥",
    credentialHelpUrl: "https://lbs.amap.com/api/mcp-server/create-project-and-key",
  },
  {
    id: "stub:baidu-maps",
    kind: "mcp",
    auth: "api_key",
    wired: true,
    fallbackName: "百度地图",
    fallbackDescription: "百度地图 MCP 服务，提供地理编码、逆地理编码、地点检索、路径规划、天气查询等功能。支持驾车、步行、骑行、公交多种出行方式的路线规划，POI搜索，IP定位等地图服务。",
    iconSrc: baiduMapsIcon,
    category: "maps",
    authFormHint: "api_key",
    mcpUrl: "https://mcp.map.baidu.com/mcp",
    apiKeyQuery: "ak",
    docsUrl: "https://lbsyun.baidu.com/apiconsole/key",
    credentialLabel: "百度地图密钥",
    credentialPlaceholder: "请输入百度地图密钥",
    credentialHelpUrl: "https://lbsyun.baidu.com/apiconsole/key",
  },
  {
    id: "stub:tencent-maps",
    kind: "mcp",
    auth: "api_key",
    wired: true,
    fallbackName: "腾讯地图",
    fallbackDescription: "腾讯位置服务 MCP：云端地理位置能力，支持地址解析、周边/沿途搜索、多出行方式路线规划、距离矩阵、IP 定位与天气查询；结果已语义化，便于大模型理解与行程推荐。",
    iconSrc: tencentMapsIcon,
    category: "maps",
    authFormHint: "api_key",
    mcpUrl: "https://mcp.map.qq.com/mcp?format=0",
    apiKeyQuery: "key",
    docsUrl: "https://lbs.qq.com/dev/console/quick-register",
    credentialLabel: "key",
    credentialPlaceholder: "开发者调用WebServiceAPI的身份标识",
    credentialHelpUrl: "https://lbs.qq.com/dev/console/quick-register",
  },
  {
    id: "stub:tencent-docs",
    kind: "mcp",
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "腾讯文档",
    fallbackDescription: "腾讯官方 MCP，支持创建/读取/编辑智能文档、表格、幻灯片等",
    iconSrc: tencentDocsIcon,
    category: "docs",
    authFormHint: "oauth_dcr",
    mcpUrl: "https://docs.qq.com/openapi/mcp",
    docsUrl: "https://docs.qq.com/open/document/saas/mcp.html",
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
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "官方Linear",
    fallbackDescription: "Linear Issue 追踪与项目管理：查看与更新 Issue、周期与项目状态，适合工程团队在对话中推进研发任务。",
    iconSrc: linearIcon,
    category: "collab",
    authFormHint: "oauth_dcr",
    mcpUrl: "https://mcp.linear.app/mcp",
    docsUrl: "https://linear.app/docs/mcp",
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
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "天眼查MCP",
    fallbackDescription: "天眼查企业工商与法律风险信息：查询企业基本信息、股东、司法风险与经营状态，辅助尽职调查与客户背调。",
    iconSrc: tianyanchaIcon,
    category: "crm",
    authFormHint: "oauth_dcr",
    mcpUrl: "https://mcp.tianyancha.com/mcp",
    docsUrl: "https://github.com/tyc-tech/tyc-cli",
  },
  {
    id: "stub:qichacha",
    kind: "mcp",
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "企查查",
    fallbackDescription: "企查查企业与知识产权查询：工商信息、专利商标、诉讼与关联企业检索，便于在对话中完成企业尽调与核验。",
    iconSrc: qichachaIcon,
    category: "crm",
    authFormHint: "oauth_dcr",
    mcpUrl: "https://agent.qcc.com/mcp/company/stream",
    docsUrl: "https://agent.qcc.com/guide",
  },
  {
    id: "stub:cloudflare",
    kind: "mcp",
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "Cloudflare",
    fallbackDescription: "Cloudflare DNS 与边缘网络 API：管理域名解析、CDN 与安全规则，把边缘基础设施运维能力接入助手自动化。",
    iconSrc: cloudflareIcon,
    category: "infra",
    authFormHint: "oauth_dcr",
    mcpUrl: "https://mcp.cloudflare.com/mcp",
    docsUrl: "https://developers.cloudflare.com/agents/model-context-protocol/mcp-servers-for-cloudflare/",
  },
  {
    id: "stub:wps-project",
    kind: "mcp",
    auth: "api_key",
    wired: true,
    fallbackName: "WPS 项目管理",
    fallbackDescription: "WPS 项目管理 MCP 面向 WPS 项目的方案管理、任务推进和流程协同场景。它将既有项目数据服务封装为标准 MCP 工具，让 WPS Comate 在获得用户授权后，能够围绕项目、任务、流程、业务数据表和组织成员完成查询与操作",
    iconSrc: wpsProjectIcon,
    category: "office",
    authFormHint: "api_key",
    mcpUrl: "https://mcp.rishiqing.com/mcp",
    credentialLabel: "Token",
    credentialPlaceholder: "输入 Token 值即可，无需填写 Bearer 前缀",
  },
  {
    id: "stub:qixin",
    kind: "mcp",
    auth: "api_key",
    wired: true,
    fallbackName: "启信慧眼",
    fallbackDescription: "面向大模型与智能体应用的企业数据 MCP Server，提供企业检索、画像、舆情、风险、产业链、招投标、股权关系等标准化工具能力，帮助模型在业务流程中稳定调用企业数据服务",
    iconSrc: qixinIcon,
    category: "crm",
    authFormHint: "api_key",
    mcpUrl: "https://mcp.qixin.com/mcp",
    docsUrl: "https://ai.qixin.com/mcp",
    credentialHelpUrl: "https://ai.qixin.com/mcp",
    credentialLabel: "Token",
    credentialPlaceholder: "输入 Token 值即可，无需填写 Bearer 前缀",
  },
  {
    id: "stub:mozlen",
    kind: "mcp",
    auth: "api_key",
    wired: true,
    fallbackName: "摩知轮",
    fallbackDescription: "摩知轮 MCP 提供对商标检索、以图查标、商标公告、企业商标图谱、实务判例、商标监控预警等摩知轮知识产权平台资源的访问能力，支持通过自然语言检索近似商标、排查商标注册风险、查询企业商标布局、调取商标司法实务案例以及自动化知识产权尽调工作流。",
    iconSrc: mozlenIcon,
    category: "legal",
    authFormHint: "api_key",
    mcpUrl: "https://www.mozlen.com/mcp",
    credentialLabel: "Token",
    credentialPlaceholder: "输入 Token 值即可，无需填写 Bearer 前缀",
  },
  {
    id: "stub:tdx",
    kind: "mcp",
    auth: "custom_credential",
    wired: true,
    fallbackName: "通达信MCP",
    fallbackDescription: "通达信 MCP 连接专业金融数据平台，支持实时行情、指数概况、K线分析、研报公告、行业分析等。APIkey获取地址：https://vip.tdx.com.cn/site/app/pc-mall/main.html#/aiKey\nhttps://vip.tdx.com.cn/site/app/pc-mall/main.html#/aiKey",
    iconSrc: tdxIcon,
    category: "finance",
    authFormHint: "token",
    mcpUrl: "https://mcp.tdx.com.cn:3001/mcp",
    credentialHeader: "tdx-api-key",
    docsUrl: "https://vip.tdx.com.cn/site/app/pc-mall/main.html#/aiKey",
    credentialHelpUrl: "https://vip.tdx.com.cn/site/app/pc-mall/main.html#/aiKey",
    credentialLabel: "您的API密钥",
    credentialPlaceholder: "请输入您的API密钥",
  },
  {
    id: "stub:moka",
    kind: "mcp",
    auth: "custom_credential",
    wired: true,
    fallbackName: "Moka 招聘管理",
    fallbackDescription: "Moka 招聘系统基本信息查询，覆盖组织架构、用户、职位、招聘需求、候选人、面试、Offer",
    iconSrc: mokaIcon,
    category: "crm",
    authFormHint: "token",
    mcpUrl: "https://mcp.mokahr.com/mcp",
    credentialHeader: "Authorization",
    credentialLabel: "Moka API Token",
    credentialPlaceholder: "输入你的 Moka API Token",
  },
  {
    // Comate fields: ['client_id', 'client_secret']
    id: "stub:yuandian",
    kind: "mcp",
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "华宇元典法律数据",
    fallbackDescription: "华宇元典法律数据为智能体提供法律法规、案例文书、企业信息 MCP 工具能力",
    iconSrc: yuandianIcon,
    category: "legal",
    authFormHint: "oauth_dcr",
    mcpUrl: "https://open.chineselaw.com/mcp",
  },
  {
    // Comate fields: ['client_id', 'client_secret']
    id: "stub:xiaoe",
    kind: "mcp",
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "小鹅通",
    fallbackDescription: "小鹅通 MCP 对接知识店铺与内容交易数据，汇聚课程、商品、订单、学员与营收等经营信息，提供运营与客服 AI Agent 所需的结构化业务数据。",
    iconSrc: xiaoeIcon,
    category: "docs",
    authFormHint: "oauth_dcr",
    mcpUrl: "https://agent.xiaoe-tech.com/mcp",
  },
  {
    // Comate fields: ['client_id', 'client_secret']
    id: "stub:lexiang",
    kind: "mcp",
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "腾讯乐享",
    fallbackDescription: "腾讯乐享 MCP 让 AI 助手能够直接与您的乐享知识库进行交互，支持搜索知识、阅读内容、创建和编辑文档、管理知识结构、上传下载文件，以及导入腾讯会议录制等操作。",
    iconSrc: lexiangIcon,
    category: "docs",
    authFormHint: "oauth_dcr",
    mcpUrl: "https://mcp.lexiang-app.com/mcp",
  },
  {
    // Comate fields: ['client_id', 'client_secret']
    id: "stub:jinshuju",
    kind: "mcp",
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "金数据",
    fallbackDescription: "用自然语言在金数据创建表单、表格、问卷、考试、报名、收款等各类场景应用：一句话生成表单与表格、批量处理数据、自动统计分析，零门槛快速搭建。",
    iconSrc: jinshujuIcon,
    category: "docs",
    authFormHint: "oauth_dcr",
    mcpUrl: "https://jinshuju.net/mcp",
  },
  {
    // Comate fields: ['client_id', 'client_secret']
    id: "stub:wkinfo",
    kind: "mcp",
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "威科先行",
    fallbackDescription: "威科先行 MCP 汇聚法律法规、司法案例、实务观点与合规参考等法律专业数据，为法务与合规 AI Agent 提供可检索的结构化法律信息。",
    iconSrc: wkinfoIcon,
    category: "legal",
    authFormHint: "oauth_dcr",
    mcpUrl: "https://mcp.wkinfo.com.cn/mcp",
  },
  {
    id: "stub:ifind",
    kind: "mcp",
    auth: "custom_credential",
    wired: true,
    fallbackName: "同花顺iFinD-A股数据",
    fallbackDescription: "链接 AI 与金融，通过 MCP 标准协议为智能投研应用提供稳定、准确、可被模型直接调用的数据引擎。API密钥获取地址：https://mcp.51ifind.cn/?syncCookieTimes=1#/profile",
    iconSrc: ifindIcon,
    category: "finance",
    authFormHint: "token",
    // Probe: POST .../ds-mcp-servers/hexin-ifind-ds-stock-mcp → 401 gateway auth；Comate Authorization Bearer。
    mcpUrl: "https://api-mcp.51ifind.com:8643/ds-mcp-servers/hexin-ifind-ds-stock-mcp",
    credentialHeader: "Authorization",
    docsUrl: "https://mcp.51ifind.com/?syncCookieTimes=1#/profile",
    credentialHelpUrl: "https://mcp.51ifind.com/?syncCookieTimes=1#/profile",
    credentialLabel: "API密钥",
    credentialPlaceholder: "Bearer <你的API密钥>",
  },
  {
    id: "stub:zhihuiya",
    kind: "mcp",
    auth: "api_key",
    wired: true,
    fallbackName: "智慧芽专利&文献融合检索",
    fallbackDescription: "可以同时在智慧芽全球专利数据库和文献库中进行深度融合搜索的专业工具。它支持自然语言查询，语义搜索和关键词搜索，并提供精准前置过滤能力，助力高效准确检索科研情报和专利信息，该MCP还可以用来获取专利或文献markdown格式的基本信息",
    iconSrc: zhihuiyaIcon,
    category: "legal",
    authFormHint: "api_key",
    // Probe: POST /api/mcp → 200「apikey not Pass」；Comate query_param apikey。
    mcpUrl: "https://connect.zhihuiya.com/api/mcp",
    apiKeyQuery: "apikey",
    docsUrl: "https://open.zhihuiya.com/dashboard/api-keys",
    credentialHelpUrl: "https://open.zhihuiya.com/dashboard/api-keys",
    credentialLabel: "apikey",
    credentialPlaceholder: "apikey",
  },
  {
    id: "stub:wj",
    kind: "mcp",
    auth: "api_key",
    wired: true,
    fallbackName: "腾讯问卷",
    fallbackDescription: "腾讯问卷官方 MCP。支持管理问卷、查看回收与统计分析。创建连接器时填写从腾讯问卷获取的个人访问 Token（wjpt_ 开头）。",
    iconSrc: wjIcon,
    category: "docs",
    authFormHint: "api_key",
    // Probe: POST /api/v2/mcp → 401 + WWW-Authenticate Bearer；Comate bearer_token wjpt_。
    mcpUrl: "https://wj.qq.com/api/v2/mcp",
    docsUrl: "https://wj.qq.com/claw",
    credentialHelpUrl: "https://wj.qq.com/claw",
    credentialLabel: "访问 Token",
    credentialPlaceholder: "以 wjpt_ 开头，可在 https://wj.qq.com/claw 获取",
  },
  {
    id: "stub:cnb",
    kind: "mcp",
    auth: "api_key",
    wired: false,
    fallbackName: "CNB",
    fallbackDescription: "CNB 云原生构建（cnb.cool）OpenAPI，常见只读场景",
    iconSrc: cnbIcon,
    category: "code",
    authFormHint: "api_key",
    // 2026-10-08 re-probe: Comate connector_type=api base https://api.cnb.cool（OpenAPI Bearer）。
    // Docs 写 https://mcp.cnb.cool/mcp，实测 POST 一律 301→https://cnb.cool（SPA）；跟随后带 Authorization 仅得 OpenAPI errcode JSON，非 MCP initialize。
    // swagger 无 /mcp；npm @cnbcool/mcp-server 仅 stdio/自托管 streamable。无可用远程 MCP JSON 端点 → 保持 unwired。
    docsUrl: "https://cnb.cool/profile/token",
    credentialHelpUrl: "https://cnb.cool/profile/token",
    credentialLabel: "Access Token",
    credentialPlaceholder: "在 CNB 个人设置-访问令牌中生成",
  },
  {
    // Comate custom_header 双字段 accessKey + secretKey。
    id: "stub:gangtise",
    kind: "mcp",
    auth: "custom_credential",
    wired: true,
    fallbackName: "Gangtise投研",
    fallbackDescription: "Gangtise MCP汇聚机构级观点，纪要，日程等另类数据，提供投研AI Agent预生成数据及全球行情/财务/估值/宏观行业等结构化数据。",
    iconSrc: gangtiseIcon,
    category: "finance",
    authFormHint: "token",
    // Probe: POST /application/open-mcp/ → 401 missing creds；双头 AK/SK 与 Comate 一致。
    mcpUrl: "https://openapi.gangtise.com/application/open-mcp/",
    docsUrl: "https://www.gangtise.com/download#/",
    credentialHelpUrl: "https://www.gangtise.com/download#/",
    credentialFields: [
      {
        name: "accessKey",
        label: "AK 密钥",
        placeholder: "请输入你的 AK 密钥",
        inputType: "text",
      },
      {
        name: "secretKey",
        label: "SK 密钥",
        placeholder: "请输入你的 SK 密钥",
        inputType: "password",
      },
    ],
  },
  {
    // Comate custom_header 双字段；probe POST /mcp → 401 empty access token。
    id: "stub:ima",
    kind: "mcp",
    auth: "custom_credential",
    wired: true,
    fallbackName: "IMA 知识库",
    fallbackDescription: "IMA 知识库开放平台 API，支持笔记管理和知识库操作。提供搜索/创建/编辑笔记、上传文件到知识库、添加网页链接、搜索知识库内容等能力。",
    iconSrc: imaIcon,
    category: "docs",
    authFormHint: "token",
    mcpUrl: "https://ima.qq.com/mcp",
    docsUrl: "https://ima.qq.com/agent-interface",
    credentialHelpUrl: "https://ima.qq.com/agent-interface",
    credentialFields: [
      {
        name: "ima-openapi-apikey",
        label: "API Key",
        placeholder: "输入你的 IMA API Key（从 ima.qq.com/agent-interface 获取）",
        inputType: "password",
      },
      {
        name: "ima-openapi-clientid",
        label: "Client ID",
        placeholder: "输入你的 IMA Client ID（从 ima.qq.com/agent-interface 获取）",
        inputType: "text",
      },
    ],
  },
  {
    id: "stub:edgeone",
    kind: "mcp",
    auth: "none",
    wired: true,
    fallbackName: "EdgeOne Makers",
    fallbackDescription: "EdgeOne Makers Deploy MCP 是一项专用服务，能够将 Web 应用快速部署到 EdgeOne Makers 并生成公开访问链接。这使您能够立即预览和分享 AI 生成的网页内容。",
    iconSrc: edgeoneIcon,
    category: "infra",
    authFormHint: "name_only",
    // Probe: POST /mcp-server → 200 initialize（无鉴权）；/mcp → 405。
    mcpUrl: "https://mcp-on-edge.edgeone.site/mcp-server",
    docsUrl: "https://mcp-on-edge.edgeone.site/mcp-server",
  },
  {
    id: "stub:fayan",
    kind: "mcp",
    auth: "mcp_oauth",
    wired: true,
    fallbackName: "法研·法律法规检索",
    fallbackDescription: "法研 MCP 提供法律法规全文检索与条文定位，汇聚现行有效法规、规章与配套文件，为法务与合规 AI Agent 提供可引用的结构化法律依据。",
    iconSrc: fayanIcon,
    category: "legal",
    authFormHint: "oauth_dcr",
    // Probe: POST /354347/mcp_law_service → 401 Bearer/COP-FYOP-AUTHORIZATION；oauth resource metadata OK。
    mcpUrl: "https://api.cjbdi.com:8443/354347/mcp_law_service",
  },
];

const RAW_CONNECTOR_SUPPLY: readonly ConnectorSupplyEntry[] = [
  {
    id: GATEWAY_SUPPLY_ID,
    kind: "gateway",
    marketSource: "enterprise",
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

export const CONNECTOR_SUPPLY: readonly ConnectorSupplyEntry[] = RAW_CONNECTOR_SUPPLY.map((e) => ({
  ...e,
  marketSource: connectorMarketSource(e),
  recommended: RECOMMENDED_SUPPLY_IDS.includes(e.id),
}));

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
    case "mcp_oauth":
      // URL 预填官方端点、收在「高级」；无任何密钥字段（DCR 自动注册客户端）。
      return ["name", "url"];
    default:
      return ["name"];
  }
}

/** 是否可用 Comate 风格新建表单（相对 oauth2 设备流 / 暂未接线说明）。 */
export function supportsCreateConnectorForm(auth: ConnectorAuthType | undefined): boolean {
  return auth === "none" || auth === "api_key" || auth === "custom_credential" || auth === "mcp_oauth";
}
