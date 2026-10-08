/**
 * 「新建连接器」纯函数：CTA 路由、表单校验、mcp.json 合并载荷、实例去重。
 * 不依赖 React；持久化由 CreateConnectorModal 调 mcpGetRaw/mcpPutRaw。
 *
 * 去重约定（不重复建设）：
 * - 每个模板（CONNECTOR_SUPPLY.id）在 mcp.json 中最多一个实例；server 名默认取模板 slug，
 *   并在 `_agenticx.templateId` 打标。同模板再次「新建」→ 返回 `exists`，UI 改为
 *   「直接使用 / 更新凭证」（覆盖同一 server，不新增条目）。
 * - 凭证相同（指纹一致）且 URL 未变 → `unchanged`，不写盘。
 * - 连接器展示名 / server 名全局唯一（`duplicate`）。
 */

import type { ConnectorAuthType, ConnectorCredentialField, ConnectorSupplyEntry } from "./connector-supply";
import { CONNECTOR_SUPPLY, authFormFields, findSupplyById, supportsCreateConnectorForm } from "./connector-supply";
import {
  buildRemoteMcpServerPayload,
  extractRemoteMcpServerConfig,
  getMcpServersMap,
  isCustomConnectorMcpConfig,
  mcpCredentialFingerprint,
  normalizeMcpUrlForCompare,
  parseMcpJsonDocument,
  readAgenticxConnectorMeta,
  setMcpServersMap,
  withAgenticxConnectorSource,
  type McpJsonDocument,
} from "../../../utils/mcp-remote-config";

export type ConnectorConnectAction = "handshake" | "gateway" | "create_form" | "unwired_sheet";

export type CreateConnectorFormValues = {
  name: string;
  url: string;
  apiKey: string;
  token: string;
  /** 多字段自定义头凭证（key = ConnectorCredentialField.name）。 */
  credentials?: Record<string, string>;
};

export type CreateConnectorFormErrors = Partial<Record<string, string>>;

/** 市场卡片 → Connect CTA 行为。 */
export function resolveConnectorConnectAction(item: {
  kind?: string;
  wired?: boolean;
  gateway?: boolean;
  connectorId?: string;
  authType?: ConnectorAuthType;
}): ConnectorConnectAction {
  if (item.gateway) return "gateway";
  if (item.wired && item.connectorId) return "handshake";
  if (item.wired === false && supportsCreateConnectorForm(item.authType)) return "create_form";
  if (item.wired === false) return "unwired_sheet";
  // wired 无 connectorId（罕见）：仍尝试表单
  if (supportsCreateConnectorForm(item.authType)) return "create_form";
  return "unwired_sheet";
}

/** 供给条目 → 新建表单的模板级预填（官方 URL / 文档 / 查询参数式 Key）。 */
export function createTargetExtrasForSupply(
  entry:
    | Pick<
        ConnectorSupplyEntry,
        | "mcpUrl"
        | "docsUrl"
        | "apiKeyQuery"
        | "credentialHeader"
        | "credentialLabel"
        | "credentialPlaceholder"
        | "credentialHelpUrl"
        | "credentialFields"
      >
    | undefined,
): {
  defaultMcpUrl?: string;
  docsUrl?: string;
  apiKeyQuery?: string;
  credentialHeader?: string;
  credentialLabel?: string;
  credentialPlaceholder?: string;
  credentialHelpUrl?: string;
  credentialFields?: readonly ConnectorCredentialField[];
} {
  if (!entry) return {};
  return {
    ...(entry.mcpUrl ? { defaultMcpUrl: entry.mcpUrl } : {}),
    ...(entry.docsUrl ? { docsUrl: entry.docsUrl } : {}),
    ...(entry.apiKeyQuery ? { apiKeyQuery: entry.apiKeyQuery } : {}),
    ...(entry.credentialHeader ? { credentialHeader: entry.credentialHeader } : {}),
    ...(entry.credentialLabel ? { credentialLabel: entry.credentialLabel } : {}),
    ...(entry.credentialPlaceholder ? { credentialPlaceholder: entry.credentialPlaceholder } : {}),
    ...(entry.credentialHelpUrl ? { credentialHelpUrl: entry.credentialHelpUrl } : {}),
    ...(entry.credentialFields?.length ? { credentialFields: entry.credentialFields } : {}),
  };
}

/**
 * 渲染期按 supplyId 重新合并目录元数据（SSOT）：市场卡片「连接」、「从模板新建」、
 * 聊天等任意入口只需给出 supplyId，凭证标签 / 占位 / 帮助链接 / 官方端点 / 鉴权位置
 * 一律取当前 CONNECTOR_SUPPLY，不依赖打开弹层那一刻的快照（Fast Refresh 保留 state 时
 * 旧快照会让表单停留在「API Key + 必填 MCP URL」旧版）。目录缺该字段时保留入口传入值。
 */
export function resolveCreateTargetWithSupply<T extends { supplyId?: string }>(
  target: T,
  supply: readonly ConnectorSupplyEntry[] = CONNECTOR_SUPPLY,
): T & ReturnType<typeof createTargetExtrasForSupply> {
  const id = (target.supplyId ?? "").trim();
  const entry = id ? findSupplyById(id, supply) : undefined;
  return { ...target, ...createTargetExtrasForSupply(entry) };
}

/** 「如何获取凭证」链接：模板专用帮助页优先，其次官方接入文档；仅放行 http(s)。 */
export function credentialHelpHref(target: { credentialHelpUrl?: string; docsUrl?: string }): string | undefined {
  const href = (target.credentialHelpUrl ?? "").trim() || (target.docsUrl ?? "").trim();
  return /^https?:\/\//i.test(href) ? href : undefined;
}

/** 「从模板新建」列表项：目录供给（不含网关）+ 走表单还是原生握手。 */
export type ConnectorTemplateOption = {
  entry: ConnectorSupplyEntry;
  action: ConnectorConnectAction;
  /** create_form / handshake 可选；oauth 等未接线模板仅展示。 */
  selectable: boolean;
};

/** 模板列表：可选项在前，保持目录原序。 */
export function listConnectorTemplates(
  supply: readonly ConnectorSupplyEntry[],
): ConnectorTemplateOption[] {
  const out = supply
    .filter((e) => e.kind !== "gateway")
    .map((entry) => {
      const action = resolveConnectorConnectAction({
        kind: "connector",
        wired: entry.wired,
        connectorId: entry.connectorId,
        authType: entry.auth,
      });
      return { entry, action, selectable: action === "create_form" || action === "handshake" };
    });
  return [...out.filter((o) => o.selectable), ...out.filter((o) => !o.selectable)];
}

/** 模板搜索（名称 / 描述 / id，大小写不敏感）。 */
export function filterConnectorTemplates<T extends { name: string; description?: string; id: string }>(
  items: readonly T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...items];
  return items.filter((i) =>
    [i.name, i.description ?? "", i.id].some((f) => f.toLowerCase().includes(q)),
  );
}

/** mcp.json server 名：小写、连字符、去非法字符；纯中文等回退到稳定 hash。 */
export function sanitizeConnectorServerName(raw: string): string {
  const input = String(raw ?? "").trim();
  const base = input
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9.-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  if (base) return base.slice(0, 64);
  if (!input) return "";
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = ((h << 5) + h + input.charCodeAt(i)) | 0;
  return `connector-${Math.abs(h).toString(36)}`.slice(0, 64);
}

export function validateCreateConnectorForm(
  auth: ConnectorAuthType,
  values: CreateConnectorFormValues,
  opts?: { credentialFields?: readonly ConnectorCredentialField[] },
): CreateConnectorFormErrors {
  const fields = new Set(authFormFields(auth));
  const errors: CreateConnectorFormErrors = {};
  const name = values.name.trim();
  if (fields.has("name") && !name) errors.name = "required_name";
  else if (name && !sanitizeConnectorServerName(name)) errors.name = "invalid_name";

  if (fields.has("url")) {
    const url = values.url.trim();
    if (!url) errors.url = "required_url";
    else {
      try {
        const u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
        if (u.protocol !== "http:" && u.protocol !== "https:") errors.url = "invalid_url";
      } catch {
        errors.url = "invalid_url";
      }
    }
  }
  const multi = (opts?.credentialFields ?? []).filter((f) => f.name.trim());
  if (multi.length > 0) {
    const creds = values.credentials ?? {};
    for (const f of multi) {
      if (f.required === false) continue;
      if (!String(creds[f.name] ?? "").trim()) errors[f.name] = "required_credential";
    }
  } else {
    if (fields.has("api_key") && !values.apiKey.trim()) errors.apiKey = "required_api_key";
    if (fields.has("token") && !values.token.trim()) errors.token = "required_token";
  }
  return errors;
}

function normalizeUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(t)) return t;
  return `https://${t}`;
}

/** 模板 id → mcp.json server slug（`stub:qingflow` → `qingflow`）。 */
export function connectorTemplateSlug(templateId?: string): string {
  const raw = String(templateId ?? "").trim().replace(/^[a-z]+:/i, "");
  return raw ? sanitizeConnectorServerName(raw) : "";
}

/** mcp.json 中一个「连接器」实例（自定义远程 / 模板创建）。 */
export type ConnectorInstance = {
  serverName: string;
  displayName: string;
  templateId?: string;
  url?: string;
  /** 凭证指纹；无凭证为空串。 */
  credentialFingerprint: string;
};

/** 列出 mcp.json 中的连接器实例（stdio / marketplace 项不算）。 */
export function listConnectorInstances(doc: McpJsonDocument): ConnectorInstance[] {
  const servers = getMcpServersMap(doc);
  const out: ConnectorInstance[] = [];
  for (const [name, raw] of Object.entries(servers)) {
    const serverName = name.trim();
    if (!serverName || !isCustomConnectorMcpConfig(raw)) continue;
    const meta = readAgenticxConnectorMeta(raw);
    const remote = extractRemoteMcpServerConfig(raw);
    out.push({
      serverName,
      displayName: meta.displayName || serverName,
      templateId: meta.templateId,
      url: remote?.url,
      credentialFingerprint: mcpCredentialFingerprint(remote?.headers),
    });
  }
  return out;
}

export type ExistingConnectorMatch = {
  instance: ConnectorInstance;
  /** same_credential：同模板且同凭证；same_template：同模板；same_server_name：未打标的旧条目占用模板 slug；same_endpoint：同 URL + 同凭证。 */
  reason: "same_credential" | "same_template" | "same_server_name" | "same_endpoint";
};

/**
 * 查找已存在的同一连接器实例。
 * 有 templateId：同模板优先按凭证指纹精确命中，否则命中同模板首个实例；
 * 再兼容未打标、server 名 = 模板 slug 的旧条目。
 * 无 templateId：按归一化 URL + 凭证指纹判重（自定义 MCP）。
 */
export function findExistingConnectorInstance(
  instances: readonly ConnectorInstance[],
  query: { templateId?: string; credentialFingerprint?: string; url?: string },
): ExistingConnectorMatch | null {
  const templateId = String(query.templateId ?? "").trim();
  const fp = query.credentialFingerprint ?? "";
  if (templateId) {
    const same = instances.filter((i) => i.templateId === templateId);
    if (fp) {
      const hit = same.find((i) => i.credentialFingerprint === fp);
      if (hit) return { instance: hit, reason: "same_credential" };
    }
    if (same.length > 0) return { instance: same[0]!, reason: "same_template" };
    const slug = connectorTemplateSlug(templateId);
    const legacy = slug ? instances.find((i) => !i.templateId && i.serverName === slug) : undefined;
    if (legacy) return { instance: legacy, reason: "same_server_name" };
  }
  const url = normalizeMcpUrlForCompare(query.url);
  if (url) {
    const hit = instances.find(
      (i) => normalizeMcpUrlForCompare(i.url) === url && i.credentialFingerprint === fp,
    );
    if (hit) return { instance: hit, reason: "same_endpoint" };
  }
  return null;
}

/** 展示名或其 server 名是否已被其它实例占用（大小写不敏感）。 */
export function isConnectorNameTaken(
  instances: readonly ConnectorInstance[],
  name: string,
  exceptServerName?: string,
): boolean {
  const want = name.trim().toLowerCase();
  if (!want) return false;
  const server = sanitizeConnectorServerName(name);
  return instances.some(
    (i) =>
      i.serverName !== exceptServerName &&
      (i.displayName.trim().toLowerCase() === want || (server !== "" && i.serverName === server)),
  );
}

/** 新建表单的模板级选项（来自供给表）。 */
export type CreateConnectorTemplateOpts = {
  templateId?: string;
  /** API Key 放进 URL 查询参数（如高德 `key`、百度 `ak`）；缺省走 Authorization: Bearer。 */
  apiKeyQuery?: string;
  /** 凭证写进自定义请求头（如盈米 `x-api-key`，原值）；缺省 Authorization: Bearer。 */
  credentialHeader?: string;
  /** 多字段自定义头；优先于单字段 credentialHeader / apiKey / token。 */
  credentialFields?: readonly ConnectorCredentialField[];
};

/** 自定义凭证头名：仅允许 RFC 7230 token 字符，避免注入。 */
function safeHeaderName(raw: string | undefined): string {
  const h = String(raw ?? "").trim();
  return /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/.test(h) ? h : "";
}

/** 把密钥写进 URL 查询参数（同名参数覆盖，其余参数保留）。 */
export function withQuerySecret(url: string, param: string, secret: string): string {
  try {
    const u = new URL(url);
    u.searchParams.set(param, secret);
    return u.toString();
  } catch {
    return url;
  }
}

/**
 * 按 auth 组装远程 MCP server 配置（headers / URL 可能含密钥，勿日志）。
 * mcp_oauth：仅官方 URL + `oauth: true`，由本机后端做 MCP OAuth 2.1（发现 + DCR + PKCE），
 * 令牌落 ~/.agenticx/connectors/oauth/（0600），不进 mcp.json。
 */
export function buildCreateConnectorServerConfig(
  auth: ConnectorAuthType,
  values: CreateConnectorFormValues,
  opts?: CreateConnectorTemplateOpts & { serverName?: string },
): { serverName: string; config: Record<string, unknown> } {
  const serverName =
    opts?.serverName || connectorTemplateSlug(opts?.templateId) || sanitizeConnectorServerName(values.name);
  let url = normalizeUrl(values.url);
  const headers: Record<string, string> = {};
  const multi = (opts?.credentialFields ?? [])
    .map((f) => ({ ...f, name: safeHeaderName(f.name) }))
    .filter((f) => f.name);
  let queryParam = "";
  let headerName = "";
  if (multi.length > 0 && auth !== "mcp_oauth") {
    const creds = values.credentials ?? {};
    for (const f of multi) {
      const v = String(creds[f.name] ?? "").trim();
      if (v) headers[f.name] = v;
    }
  } else {
    queryParam = auth === "api_key" ? String(opts?.apiKeyQuery ?? "").trim() : "";
    headerName =
      !queryParam && (auth === "api_key" || auth === "custom_credential") ? safeHeaderName(opts?.credentialHeader) : "";
    const secret = auth === "api_key" ? values.apiKey.trim() : auth === "custom_credential" ? values.token.trim() : "";
    if (secret) {
      if (queryParam) url = withQuerySecret(url, queryParam, secret);
      else if (headerName) headers[headerName] = secret;
      else headers.Authorization = `Bearer ${secret}`;
    }
  }
  const payload = buildRemoteMcpServerPayload(url, auth === "mcp_oauth" ? {} : headers);
  if (auth === "mcp_oauth") payload.oauth = true;
  return {
    serverName,
    config: withAgenticxConnectorSource(payload, {
      templateId: opts?.templateId,
      displayName: values.name,
      ...(queryParam ? { authStyle: "query", authQuery: queryParam } : {}),
      ...(headerName ? { authStyle: "header", authHeader: headerName } : {}),
      ...(multi.length > 0 ? { authStyle: "headers", authHeaders: multi.map((f) => f.name) } : {}),
      ...(auth === "mcp_oauth" ? { authStyle: "none" } : {}),
    }),
  };
}

/** mcp.json 条目是否走标准 MCP OAuth（`oauth: true` + 远程 URL）。 */
export function isMcpOauthServerConfig(raw: unknown): boolean {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const r = raw as Record<string, unknown>;
  return r.oauth === true && typeof r.url === "string" && r.url.trim() !== "";
}

export type ApplyCreateConnectorResult =
  | {
      ok: true;
      text: string;
      serverName: string;
      displayName: string;
      /** 写入的是已存在的 server（更新凭证）。 */
      existed: boolean;
      /** 同模板同凭证同端点：直接复用，未改动文件。 */
      unchanged: boolean;
    }
  | {
      ok: false;
      error: "invalid_json" | "duplicate" | "invalid_form" | "exists";
      errors?: CreateConnectorFormErrors;
      /** error=exists 时：已存在的实例。 */
      existing?: ExistingConnectorMatch;
    };

/**
 * 合并进 mcp.json 文本。
 * - 同模板已有实例：默认返回 `exists`；`overwrite` 时更新该实例（不新增）。
 * - 名称冲突：返回 `duplicate`（避免静默覆盖或出现同名实例）。
 */
export function applyCreateConnectorToMcpJson(
  text: string,
  auth: ConnectorAuthType,
  values: CreateConnectorFormValues,
  opts?: { overwrite?: boolean } & CreateConnectorTemplateOpts,
): ApplyCreateConnectorResult {
  const errors = validateCreateConnectorForm(auth, values, { credentialFields: opts?.credentialFields });
  if (Object.keys(errors).length > 0) return { ok: false, error: "invalid_form", errors };
  let doc: McpJsonDocument;
  try {
    doc = parseMcpJsonDocument(text);
  } catch {
    return { ok: false, error: "invalid_json" };
  }
  const templateId = String(opts?.templateId ?? "").trim() || undefined;
  const servers = getMcpServersMap(doc);
  const instances = listConnectorInstances(doc);
  const tplOpts: CreateConnectorTemplateOpts = {
    templateId,
    apiKeyQuery: opts?.apiKeyQuery,
    credentialHeader: opts?.credentialHeader,
    credentialFields: opts?.credentialFields,
  };
  const draft = buildCreateConnectorServerConfig(auth, values, tplOpts);
  const draftRemote = extractRemoteMcpServerConfig(draft.config);
  const draftFp = mcpCredentialFingerprint(draftRemote?.headers);
  const displayName = values.name.trim();

  const existing = findExistingConnectorInstance(instances, {
    templateId,
    credentialFingerprint: draftFp,
    url: draftRemote?.url,
  });

  if (existing) {
    if (!opts?.overwrite) return { ok: false, error: "exists", existing };
    const target = existing.instance;
    if (displayName && isConnectorNameTaken(instances, displayName, target.serverName)) {
      return { ok: false, error: "duplicate" };
    }
    const unchanged =
      target.credentialFingerprint === draftFp &&
      isMcpOauthServerConfig(servers[target.serverName]) === isMcpOauthServerConfig(draft.config) &&
      normalizeMcpUrlForCompare(target.url) === normalizeMcpUrlForCompare(draftRemote?.url) &&
      target.displayName === (displayName || target.displayName) &&
      Boolean(target.templateId) === Boolean(templateId);
    if (unchanged) {
      return {
        ok: true,
        text,
        serverName: target.serverName,
        displayName: target.displayName,
        existed: true,
        unchanged: true,
      };
    }
    const { config } = buildCreateConnectorServerConfig(auth, values, {
      ...tplOpts,
      serverName: target.serverName,
    });
    servers[target.serverName] = config;
    return {
      ok: true,
      serverName: target.serverName,
      displayName: displayName || target.displayName,
      existed: true,
      unchanged: false,
      text: `${JSON.stringify(setMcpServersMap(doc, servers), null, 2)}\n`,
    };
  }

  if (isConnectorNameTaken(instances, displayName)) return { ok: false, error: "duplicate" };
  let serverName = draft.serverName;
  if (Object.prototype.hasOwnProperty.call(servers, serverName)) {
    // 模板 slug 被非连接器条目（stdio / 市场 MCP）占用：换用名称派生 / 追加序号，绝不覆盖。
    if (!templateId) {
      if (!opts?.overwrite) return { ok: false, error: "duplicate" };
    } else {
      const base = sanitizeConnectorServerName(displayName) || serverName;
      let candidate = base;
      for (let n = 2; Object.prototype.hasOwnProperty.call(servers, candidate); n++) {
        candidate = `${base}-${n}`;
      }
      serverName = candidate;
    }
  }
  const { config } = buildCreateConnectorServerConfig(auth, values, { ...tplOpts, serverName });
  const existed = Object.prototype.hasOwnProperty.call(servers, serverName);
  servers[serverName] = config;
  return {
    ok: true,
    serverName,
    displayName,
    existed,
    unchanged: false,
    text: `${JSON.stringify(setMcpServersMap(doc, servers), null, 2)}\n`,
  };
}
