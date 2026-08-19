/**
 * 两个外部市场的读取封装。
 *
 * 只做「搜索」和「读详情」，不下载、不执行、不扫描——拉回来的是一段元数据，用来把
 * 表单填上，管理员确认后才写进本企业的注册表。装什么是管理员的决定。
 *
 * 刻意不引 Python 侧那条链路：这两个上游都是普通 HTTP，Node 直接发就行，不值得为此
 * 在部署里加一个运行时。
 */

const SKILLHUB_SEARCH = "https://api.skillhub.cn/api/v1/search";
const MODELSCOPE_MCP = "https://www.modelscope.cn/openapi/v1/mcp/servers";
const MODELSCOPE_MCP_DETAIL = (id: string) =>
  `${MODELSCOPE_MCP}/${encodeURIComponent(id)}`;
const TIMEOUT_MS = 15_000;

export type MarketSkill = {
  name: string;
  displayName: string;
  description: string;
  version: string;
  author: string;
  namespace: string;
  /** `@handle/slug`，市场里的唯一全名。登记时用它，不用可变的展示名。 */
  canonicalName: string;
  detailUrl: string;
};

export type MarketMcpServer = {
  id: string;
  name: string;
  description: string;
  publisher: string;
  hosted: boolean;
  verified: boolean;
  detailUrl: string;
};

export class UpstreamUnreachableError extends Error {
  constructor(readonly upstream: string, cause: unknown) {
    super(`无法访问 ${upstream}：${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "UpstreamUnreachableError";
  }
}

async function getJson(url: string, init: RequestInit, upstream: string): Promise<unknown> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (error) {
    // 内网隔离的客户根本连不到这些站点。抛一个能被界面识别的错误，让页面老实说
    // 「连不上市场，请手工登记」，而不是转圈或者假装搜不到东西。
    throw new UpstreamUnreachableError(upstream, error);
  }
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

export async function searchSkillHub(query: string): Promise<MarketSkill[]> {
  const url = new URL(SKILLHUB_SEARCH);
  url.searchParams.set("limit", "50");
  if (query.trim()) url.searchParams.set("q", query.trim());
  const payload = (await getJson(url.toString(), { method: "GET" }, "SkillHub")) as {
    results?: unknown[];
    items?: unknown[];
  };
  const rows = (payload.results ?? payload.items ?? []) as Array<Record<string, unknown>>;
  return rows.map((row) => {
    // 字段名按真实返回校正过：作者在 namespace.handle，没有独立的 author；
    // 中文说明在 description_zh；详情页是 homepage，不是 detail_url。
    const namespace = (row.namespace ?? {}) as Record<string, unknown>;
    const name = text(row.name);
    const handle = text(namespace.handle);
    return {
      name,
      displayName: text(row.displayName, name),
      description: text(row.description_zh, text(row.description)),
      version: text(row.version, "0.1.0"),
      author: handle,
      namespace: handle,
      // 登记时要能唯一定位这个技能：@handle/slug 才是它在市场里的全名。
      canonicalName: text(namespace.canonicalName, handle && name ? `@${handle}/${name}` : name),
      detailUrl: text(row.homepage),
    };
  });
}

export async function searchMcpMarketplace(
  query: string,
  page = 1,
  pageSize = 30,
): Promise<{ items: MarketMcpServer[]; total: number }> {
  const token = process.env.MODELSCOPE_API_TOKEN?.trim();
  const payload = (await getJson(
    MODELSCOPE_MCP,
    {
      // ModelScope 这个检索接口用的是 PUT，不是笔误。
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "AgenticX-Enterprise",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        filter: query.trim() ? { search: query.trim() } : {},
        page_number: page,
        page_size: pageSize,
      }),
    },
    "ModelScope MCP 市场",
  )) as { data?: { mcp_server_list?: unknown[]; total_count?: number } };

  const rows = (payload.data?.mcp_server_list ?? []) as Array<Record<string, unknown>>;
  return {
    items: rows.map((row) => {
      const id = text(row.id, text(row.server_id));
      return {
        id,
        name: text(row.chinese_name, text(row.name, id)),
        description: text(row.description),
        publisher: text(row.publisher, text(row.author)),
        hosted: Boolean(row.is_hosted),
        verified: Boolean(row.is_verified),
        detailUrl: id ? `https://www.modelscope.cn/mcp/servers/${encodeURIComponent(id)}` : "",
      };
    }),
    total: Number(payload.data?.total_count ?? 0),
  };
}

/** 市场详情里能直接用来预填登记表单的部分。 */
export type MarketMcpDetail = {
  id: string;
  name: string;
  description: string;
  /** 建议的服务名：企业注册表里要唯一，用市场 id 的最后一段。 */
  suggestedName: string;
  /** stdio 启动命令，来自 server_config 的 mcpServers 段。 */
  command: string;
  args: string[];
  /** 托管地址，有就优先用它（不需要在企业机器上装运行时）。 */
  endpoint: string;
  /** 需要哪些环境变量——凭据得管理员自己填，市场不会给。 */
  requiredEnv: string[];
  readme: string;
  detailUrl: string;
};

/**
 * 从 server_config 里挑一条能用的连接方式。
 *
 * ModelScope 的 server_config 是标准 mcp.json 形状：[{mcpServers:{名字:{command,args,env}}}]，
 * 一个条目里可能有多个服务。取第一个——多数只有一个，多的那些是同一服务的不同变体，
 * 让管理员在表单里改比在这儿猜规则强。
 */
function firstServerEntry(config: unknown): { name: string; command: string; args: string[] } {
  const blocks = Array.isArray(config) ? config : [config];
  for (const block of blocks) {
    const servers = (block as Record<string, unknown> | null)?.mcpServers;
    if (!servers || typeof servers !== "object") continue;
    for (const [name, raw] of Object.entries(servers as Record<string, unknown>)) {
      const entry = (raw ?? {}) as Record<string, unknown>;
      return {
        name,
        command: text(entry.command),
        args: Array.isArray(entry.args) ? entry.args.map((a) => String(a)) : [],
      };
    }
  }
  return { name: "", command: "", args: [] };
}

export async function fetchMcpDetail(id: string): Promise<MarketMcpDetail> {
  const token = process.env.MODELSCOPE_API_TOKEN?.trim();
  const payload = (await getJson(
    MODELSCOPE_MCP_DETAIL(id),
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "AgenticX-Enterprise",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    },
    "ModelScope MCP 市场",
  )) as { data?: Record<string, unknown> };

  const data = payload.data ?? {};
  const entry = firstServerEntry(data.server_config);
  const urls = Array.isArray(data.operational_urls) ? data.operational_urls : [];
  const envSchema = (data.env_schema ?? {}) as { required?: unknown; properties?: unknown };
  // 服务名要能进企业注册表且唯一：市场 id 形如 @scope/name，取末段并去掉不合法字符。
  const tail = String(id).split("/").pop() ?? String(id);
  return {
    id: String(id),
    name: text(data.chinese_name, text(data.name, String(id))),
    description: text(data.description),
    suggestedName: (entry.name || tail).replace(/[^a-zA-Z0-9_-]/g, "-").toLowerCase(),
    command: entry.command,
    args: entry.args,
    endpoint: text((urls[0] as Record<string, unknown> | undefined)?.url, text(urls[0])),
    requiredEnv: Array.isArray(envSchema.required) ? envSchema.required.map((k) => String(k)) : [],
    readme: text(data.readme).slice(0, 4000),
    detailUrl: `https://www.modelscope.cn/mcp/servers/${encodeURIComponent(String(id))}`,
  };
}
