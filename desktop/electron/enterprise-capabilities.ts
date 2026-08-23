/**
 * 企业能力（MCP / Skill）在桌面端的落地形态。
 *
 * 后端下发的是「当下这个员工能调用的东西」——被企业停用或被本人关掉的根本不在
 * 列表里，所以这里不需要再判一次开关，**没出现就等于已撤销**，本地要跟着删掉。
 *
 * MCP 条目写进 `~/.agenticx/mcp.json`，但只删自己上次写过的名字（记在企业配置的
 * `managed_mcp_servers` 里），不按前缀猜。按前缀猜会在员工自己建了同名条目时把
 * 人家的配置删掉，而这个误删没有任何提示。
 */

export type EnterpriseCapability = {
  /** `mcp:<ulid>` / `skill:<ulid>` */
  id: string;
  kind: "mcp" | "skill";
  name: string;
  displayName: string;
  requires: string[];
  version?: string;
  bundleUri?: string;
  bundleDigest?: string;
  /** MCP 专有：网关反代入口。缺省说明网关没配好，这条能力连不了。 */
  endpointUrl?: string;
};

/** 企业下发的 MCP 在本地统一挂这个前缀，一眼能和自己配的区分开。 */
export const ENTERPRISE_MCP_NAME_PREFIX = "enterprise-";

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(text).filter(Boolean))];
}

export function normalizeEnterpriseCapabilities(value: unknown): EnterpriseCapability[] {
  if (!Array.isArray(value)) return [];
  const out: EnterpriseCapability[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    const record = asRecord(item);
    if (!record) continue;
    const id = text(record.id);
    const kind = text(record.kind);
    if (!id || seen.has(id)) continue;
    if (kind !== "mcp" && kind !== "skill") continue;
    const name = text(record.name);
    if (!name) continue;
    seen.add(id);
    out.push({
      id,
      kind,
      name,
      displayName: text(record.displayName) || name,
      requires: stringList(record.requires),
      ...(text(record.version) ? { version: text(record.version) } : {}),
      ...(text(record.bundleUri) ? { bundleUri: text(record.bundleUri) } : {}),
      ...(text(record.bundleDigest) ? { bundleDigest: text(record.bundleDigest) } : {}),
      ...(text(record.endpointUrl) ? { endpointUrl: text(record.endpointUrl) } : {}),
    });
  }
  return out;
}

/** MCP 名字会成为工具名前缀，这里收敛成安全字符。 */
export function enterpriseMcpEntryName(capability: EnterpriseCapability): string {
  const slug = capability.name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${ENTERPRISE_MCP_NAME_PREFIX}${slug || capability.id.replace(/[^a-z0-9]+/gi, "-")}`;
}

export function buildEnterpriseMcpEntry(
  capability: EnterpriseCapability,
  token: string,
): Record<string, unknown> {
  return {
    url: capability.endpointUrl,
    headers: { Authorization: `Bearer ${token}` },
    transport: "streamable_http",
  };
}

export type McpDocument = Record<string, unknown> & { mcpServers?: Record<string, unknown> };

export type SyncEnterpriseMcpResult = {
  document: McpDocument;
  /** 本次写进去的名字，存回企业配置，下次据此精确删除。 */
  managedNames: string[];
  /** 想用的名字已被员工自己占了，没有覆盖；这条能力这次没生效。 */
  conflicts: string[];
};

function serversOf(document: McpDocument): Record<string, unknown> {
  const nested = document.mcpServers;
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? { ...(nested as Record<string, unknown>) }
    : {};
}

/**
 * 把企业 MCP 合进 mcp.json：新增/更新在册的，删掉上次写过但这次没下发的。
 *
 * 没有 endpointUrl 的能力会被跳过——网关地址没配好时写个连不上的条目进去，
 * 只会让员工看到一个永远红着的服务器。
 */
export function syncEnterpriseMcpDocument(
  document: McpDocument,
  capabilities: readonly EnterpriseCapability[],
  token: string,
  previouslyManaged: readonly string[],
): SyncEnterpriseMcpResult {
  const servers = serversOf(document);
  const desired = new Map<string, Record<string, unknown>>();
  const conflicts: string[] = [];

  for (const capability of capabilities) {
    if (capability.kind !== "mcp" || !capability.endpointUrl) continue;
    const name = enterpriseMcpEntryName(capability);
    const occupied =
      Object.prototype.hasOwnProperty.call(servers, name) && !previouslyManaged.includes(name);
    if (occupied) {
      conflicts.push(name);
      continue;
    }
    desired.set(name, buildEnterpriseMcpEntry(capability, token));
  }

  // 只删自己写过的：没下发 = 已撤销，本地留着就等于撤销没生效。
  for (const name of previouslyManaged) {
    if (!desired.has(name)) delete servers[name];
  }
  for (const [name, entry] of desired) servers[name] = entry;

  return {
    document: { ...document, mcpServers: servers },
    managedNames: [...desired.keys()].sort(),
    conflicts: conflicts.sort(),
  };
}

/** 退出企业账户：把自己写过的条目全部撤走，员工自己的原样保留。 */
export function removeEnterpriseMcpDocument(
  document: McpDocument,
  previouslyManaged: readonly string[],
): McpDocument {
  const servers = serversOf(document);
  for (const name of previouslyManaged) delete servers[name];
  return { ...document, mcpServers: servers };
}

/**
 * Skill 的 bundle 约定：`bundleUri` 返回 SKILL.md 正文，`bundleDigest` 是其 sha256
 * 十六进制。仓库里既有的托管技能都是「一个目录一份 SKILL.md」，这里沿用同一形态，
 * 不引入压缩包解压——解压是路径穿越的高发地带，为一个尚未有生产方的格式冒这个险
 * 不划算。真要换成压缩包，改动只落在这个文件和写盘那一处。
 */

export type EnterpriseSkillInstall = {
  capability: EnterpriseCapability;
  dirName: string;
  bundleUri: string;
  bundleDigest: string;
};

export type EnterpriseSkillSkip = {
  id: string;
  name: string;
  reason: "no-bundle" | "no-digest" | "insecure-uri";
};

export type EnterpriseSkillPlan = {
  install: EnterpriseSkillInstall[];
  /** 上次装过、这次没下发的目录名：撤销了就得从盘上消失。 */
  remove: string[];
  skipped: EnterpriseSkillSkip[];
};

export function enterpriseSkillDirName(capability: EnterpriseCapability): string {
  return (
    capability.name
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "") || capability.id.replace(/[^a-z0-9]+/gi, "-")
  );
}

/** 只接受 https；http 仅限本机，供本地联调。 */
export function isAcceptableBundleUri(uri: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(uri);
  } catch {
    return false;
  }
  if (parsed.protocol === "https:") return true;
  if (parsed.protocol !== "http:") return false;
  const host = parsed.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
}

export function planEnterpriseSkills(
  capabilities: readonly EnterpriseCapability[],
  previouslyManaged: readonly string[],
): EnterpriseSkillPlan {
  const install: EnterpriseSkillInstall[] = [];
  const skipped: EnterpriseSkillSkip[] = [];

  for (const capability of capabilities) {
    if (capability.kind !== "skill") continue;
    const bundleUri = capability.bundleUri ?? "";
    const bundleDigest = capability.bundleDigest ?? "";
    if (!bundleUri) {
      skipped.push({ id: capability.id, name: capability.name, reason: "no-bundle" });
      continue;
    }
    if (!isAcceptableBundleUri(bundleUri)) {
      skipped.push({ id: capability.id, name: capability.name, reason: "insecure-uri" });
      continue;
    }
    // 没有摘要就无法判断下下来的是不是原文，宁可不装。
    if (!bundleDigest) {
      skipped.push({ id: capability.id, name: capability.name, reason: "no-digest" });
      continue;
    }
    install.push({
      capability,
      dirName: enterpriseSkillDirName(capability),
      bundleUri,
      bundleDigest: bundleDigest.toLowerCase(),
    });
  }

  const keep = new Set(install.map((item) => item.dirName));
  return {
    install,
    remove: [...previouslyManaged].filter((name) => !keep.has(name)).sort(),
    skipped,
  };
}
