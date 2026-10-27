export type ToolPolicyChoice = "inherit" | "always_allow" | "always_ask";
export type ToolConfigRow = { name: string; policy: ToolPolicyChoice; enabled: boolean };
export type BuiltinToolsetForm = {
  present: boolean;
  defaultPolicy: "always_allow" | "always_ask";
  configs: ToolConfigRow[];
};
export type McpServerForm = {
  name: string;
  url: string;
  transport: "http" | "sse";
  defaultPolicy: "always_allow" | "always_ask";
  configs: ToolConfigRow[];
  hasToolset: boolean;
};
export type CustomToolForm = { name: string; description: string; inputSchemaText: string };
export type SkillForm = { source: "builtin" | "tenant"; id: string; version: string | null };
export type ManifestFormState = {
  model: string;
  system: string;
  builtin: BuiltinToolsetForm;
  mcpServers: McpServerForm[];
  customTools: CustomToolForm[];
  skills: SkillForm[];
  maxToolRounds: string;
  maxSessionTokens: string;
  welcomeMessage: string;
  suggestedQuestionsText: string;
};

export class ManifestFormError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManifestFormError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asPolicyChoice(value: unknown): ToolPolicyChoice {
  if (value === "always_allow" || value === "always_ask") return value;
  return "inherit";
}

function asDefaultPolicy(value: unknown): "always_allow" | "always_ask" {
  return value === "always_ask" ? "always_ask" : "always_allow";
}

function asTransport(value: unknown): "http" | "sse" {
  return value === "sse" ? "sse" : "http";
}

function readConfigs(value: unknown): ToolConfigRow[] {
  if (!Array.isArray(value)) return [];
  const rows: ToolConfigRow[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== "string") continue;
    rows.push({
      name: item.name,
      policy: asPolicyChoice(item.policy),
      enabled: item.enabled !== false,
    });
  }
  return rows;
}

function readSuggested(metadata: Record<string, unknown>): string {
  const value = metadata.suggested_questions;
  if (!Array.isArray(value)) return "";
  return value.filter((item): item is string => typeof item === "string").join("\n");
}

const EMPTY_BUILTIN: BuiltinToolsetForm = { present: false, defaultPolicy: "always_allow", configs: [] };

export function manifestToForm(manifest: Record<string, unknown>): ManifestFormState {
  const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
  let builtin: BuiltinToolsetForm = { ...EMPTY_BUILTIN, configs: [] };
  const mcpToolsets = new Map<string, { defaultPolicy: "always_allow" | "always_ask"; configs: ToolConfigRow[] }>();
  const customTools: CustomToolForm[] = [];

  for (const tool of tools) {
    if (!isRecord(tool) || typeof tool.type !== "string") continue;
    switch (tool.type) {
      case "agx_builtin":
        builtin = {
          present: true,
          defaultPolicy: asDefaultPolicy(tool.default_policy),
          configs: readConfigs(tool.configs),
        };
        break;
      case "mcp":
        if (typeof tool.server === "string") {
          mcpToolsets.set(tool.server, {
            defaultPolicy: asDefaultPolicy(tool.default_policy),
            configs: readConfigs(tool.configs),
          });
        }
        break;
      case "custom":
        customTools.push({
          name: typeof tool.name === "string" ? tool.name : "",
          description: typeof tool.description === "string" ? tool.description : "",
          inputSchemaText: JSON.stringify(isRecord(tool.input_schema) ? tool.input_schema : {}, null, 2),
        });
        break;
      default:
        break;
    }
  }

  const mcpServers: McpServerForm[] = [];
  const servers = Array.isArray(manifest.mcp_servers) ? manifest.mcp_servers : [];
  for (const server of servers) {
    if (!isRecord(server) || typeof server.name !== "string") continue;
    const toolset = mcpToolsets.get(server.name);
    mcpServers.push({
      name: server.name,
      url: typeof server.url === "string" ? server.url : "",
      transport: asTransport(server.transport),
      defaultPolicy: toolset?.defaultPolicy ?? "always_allow",
      configs: toolset?.configs ?? [],
      hasToolset: toolset !== undefined,
    });
  }

  const skills: SkillForm[] = [];
  const skillRows = Array.isArray(manifest.skills) ? manifest.skills : [];
  for (const skill of skillRows) {
    if (!isRecord(skill) || (skill.source !== "builtin" && skill.source !== "tenant")) continue;
    if (typeof skill.id !== "string") continue;
    skills.push({
      source: skill.source,
      id: skill.id,
      version: typeof skill.version === "string" ? skill.version : null,
    });
  }

  const runtime = isRecord(manifest.runtime) ? manifest.runtime : {};
  const metadata = isRecord(manifest.metadata) ? manifest.metadata : {};
  const welcome = metadata.welcome_message;

  return {
    model: typeof manifest.model === "string" ? manifest.model : "",
    system: typeof manifest.system === "string" ? manifest.system : "",
    builtin,
    mcpServers,
    customTools,
    skills,
    maxToolRounds: typeof runtime.max_tool_rounds === "number" ? String(runtime.max_tool_rounds) : "",
    maxSessionTokens: typeof runtime.max_session_tokens === "number" ? String(runtime.max_session_tokens) : "",
    welcomeMessage: typeof welcome === "string" ? welcome : "",
    suggestedQuestionsText: readSuggested(metadata),
  };
}

function findNamedConfig(configs: unknown, name: string): Record<string, unknown> | undefined {
  if (!Array.isArray(configs)) return undefined;
  for (const item of configs) {
    if (isRecord(item) && item.name === name) return item;
  }
  return undefined;
}

function baseBuiltinConfigs(base: Record<string, unknown>): unknown {
  const tools = Array.isArray(base.tools) ? base.tools : [];
  for (const tool of tools) {
    if (isRecord(tool) && tool.type === "agx_builtin") return tool.configs;
  }
  return [];
}

function baseMcpConfigs(base: Record<string, unknown>, server: string): unknown {
  const tools = Array.isArray(base.tools) ? base.tools : [];
  for (const tool of tools) {
    if (isRecord(tool) && tool.type === "mcp" && tool.server === server) return tool.configs;
  }
  return [];
}

/**
 * 新建的工具行：inherit 不输出 policy，enabled=true 不输出 enabled。
 * 若 base 里同名配置已经显式带 policy:null / enabled:true（校验后的规范化形态），原样保留，
 * 这样规范化 manifest 可以无损往返。
 */
function emitConfig(row: ToolConfigRow, baseConfig: Record<string, unknown> | undefined): Record<string, unknown> {
  const config: Record<string, unknown> = { name: row.name };
  if (row.policy === "inherit") {
    if (baseConfig && Object.prototype.hasOwnProperty.call(baseConfig, "policy") && baseConfig.policy == null) {
      config.policy = null;
    }
  } else {
    config.policy = row.policy;
  }
  if (!row.enabled) {
    config.enabled = false;
  } else if (baseConfig && baseConfig.enabled === true) {
    config.enabled = true;
  }
  return config;
}

function parseLimit(raw: string, empty: number | null): number | null {
  const text = raw.trim();
  if (!text) return empty;
  if (!/^-?\d+$/.test(text)) throw new ManifestFormError("运行限制须为整数");
  return Number(text);
}

/**
 * 以 base 为底，保留 metadata 中除 welcome_message / suggested_questions 外的键，
 * 用 form 覆盖 model / system / tools / mcp_servers / skills / runtime / metadata。
 */
export function formToManifest(form: ManifestFormState, base: Record<string, unknown>): Record<string, unknown> {
  const tools: Record<string, unknown>[] = [];
  if (form.builtin.present) {
    const baseConfigs = baseBuiltinConfigs(base);
    tools.push({
      type: "agx_builtin",
      default_policy: form.builtin.defaultPolicy,
      configs: form.builtin.configs.map((row) => emitConfig(row, findNamedConfig(baseConfigs, row.name))),
    });
  }
  for (const server of form.mcpServers) {
    if (!server.hasToolset) continue;
    const baseConfigs = baseMcpConfigs(base, server.name);
    tools.push({
      type: "mcp",
      server: server.name,
      default_policy: server.defaultPolicy,
      configs: server.configs.map((row) => emitConfig(row, findNamedConfig(baseConfigs, row.name))),
    });
  }
  for (const tool of form.customTools) {
    let inputSchema: Record<string, unknown>;
    try {
      const parsed = JSON.parse(tool.inputSchemaText) as unknown;
      if (!isRecord(parsed)) throw new Error("not object");
      inputSchema = parsed;
    } catch (error) {
      if (error instanceof ManifestFormError) throw error;
      throw new ManifestFormError(`自定义工具 ${tool.name} 的输入参数不是合法 JSON`);
    }
    tools.push({
      type: "custom",
      name: tool.name,
      description: tool.description,
      input_schema: inputSchema,
    });
  }

  const metadata: Record<string, unknown> = isRecord(base.metadata) ? { ...base.metadata } : {};
  delete metadata.welcome_message;
  delete metadata.suggested_questions;
  if (form.welcomeMessage.trim()) metadata.welcome_message = form.welcomeMessage;
  const suggested = form.suggestedQuestionsText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (suggested.length > 0) metadata.suggested_questions = suggested;

  return {
    ...base,
    model: form.model,
    system: form.system,
    tools,
    mcp_servers: form.mcpServers.map((server) => ({
      name: server.name,
      url: server.url,
      transport: server.transport,
    })),
    skills: form.skills.map((skill) => ({
      source: skill.source,
      id: skill.id,
      version: skill.version,
    })),
    runtime: {
      max_tool_rounds: parseLimit(form.maxToolRounds, 40),
      max_session_tokens: parseLimit(form.maxSessionTokens, null),
    },
    metadata,
  };
}
