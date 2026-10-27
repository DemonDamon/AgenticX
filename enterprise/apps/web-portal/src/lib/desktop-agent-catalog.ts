import type { EnterpriseAgent, EnterpriseAgentWithMa, MaEnvironment } from "@agenticx/iam-core";

export type DesktopAgentCard = {
  id: string;
  slug: string;
  displayName: string;
  description: string | null;
  runtime: "cloud" | "desktop_worker";
  model: string;
  origin: "enterprise" | "employee";
  systemPrompt: string;
  latestVersion: number;
  effectiveVersion: number;
  routingMode: "follow_latest" | "pinned";
  defaultEnvironment: { id: string; name: string; type: "cloud" | "desktop_worker" } | null;
  executionTarget: "cloud" | "desktop_worker";
  ownedByMe: boolean;
};

export type ToolPolicyName = "always_allow" | "always_ask";

export type ManifestOverride = {
  name: string;
  policy: ToolPolicyName | null;
  enabled: boolean;
};

export type ManifestSummary = {
  model: string;
  system: string;
  builtin: { defaultPolicy: ToolPolicyName; overrides: ManifestOverride[] } | null;
  mcp: Array<{
    server: string;
    transport: "http" | "sse";
    defaultPolicy: ToolPolicyName;
    overrides: ManifestOverride[];
  }>;
  custom: Array<{ name: string; description: string }>;
  skills: Array<{ source: string; id: string; version: string | null }>;
  maxToolRounds: number;
  welcomeMessage: string | null;
  suggestedQuestions: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRuntime(value: unknown): "cloud" | "desktop_worker" {
  return value === "desktop_worker" ? "desktop_worker" : "cloud";
}

function resolveEnvironment(
  environmentId: string | null | undefined,
  envById: ReadonlyMap<string, MaEnvironment>,
): DesktopAgentCard["defaultEnvironment"] {
  if (!environmentId) return null;
  const env = envById.get(environmentId);
  if (!env || env.status !== "active") return null;
  if (env.type !== "cloud" && env.type !== "desktop_worker") return null;
  return { id: env.id, name: env.name, type: env.type };
}

export function toDesktopAgentCard(
  agent: EnterpriseAgent,
  ma: EnterpriseAgentWithMa | undefined,
  envById: ReadonlyMap<string, MaEnvironment>,
  viewerUserId: string,
): DesktopAgentCard {
  const runtime = asRuntime(agent.runtime);
  const defaultEnvironment = resolveEnvironment(ma?.defaultEnvironmentId, envById);
  return {
    id: agent.id,
    slug: agent.slug,
    displayName: agent.displayName,
    description: agent.description,
    runtime,
    model: agent.model,
    origin: agent.origin === "employee" ? "employee" : "enterprise",
    systemPrompt: agent.systemPrompt,
    latestVersion: ma?.latestVersion ?? 1,
    effectiveVersion: ma?.effectiveVersion ?? 1,
    routingMode: ma?.versionRouting === "pinned" ? "pinned" : "follow_latest",
    defaultEnvironment,
    executionTarget: defaultEnvironment?.type ?? runtime,
    ownedByMe: agent.origin === "employee" && agent.ownerUserId === viewerUserId,
  };
}

function emptySummary(): ManifestSummary {
  return {
    model: "",
    system: "",
    builtin: null,
    mcp: [],
    custom: [],
    skills: [],
    maxToolRounds: 40,
    welcomeMessage: null,
    suggestedQuestions: [],
  };
}

function readPolicy(value: unknown, fallback: ToolPolicyName): ToolPolicyName {
  return value === "always_allow" || value === "always_ask" ? value : fallback;
}

function readOverrides(configs: unknown): ManifestOverride[] {
  if (!Array.isArray(configs)) return [];
  const overrides: ManifestOverride[] = [];
  for (const item of configs) {
    if (!isRecord(item) || typeof item.name !== "string" || item.name.length === 0) continue;
    const policy = item.policy === "always_allow" || item.policy === "always_ask" ? item.policy : null;
    const enabled = typeof item.enabled === "boolean" ? item.enabled : true;
    overrides.push({ name: item.name, policy, enabled });
  }
  return overrides;
}

function mcpTransport(servers: unknown, name: string): "http" | "sse" {
  if (!Array.isArray(servers)) return "http";
  for (const item of servers) {
    if (!isRecord(item) || item.name !== name) continue;
    return item.transport === "sse" ? "sse" : "http";
  }
  return "http";
}

function readSkills(skills: unknown): ManifestSummary["skills"] {
  if (!Array.isArray(skills)) return [];
  const out: ManifestSummary["skills"] = [];
  for (const item of skills) {
    if (!isRecord(item) || typeof item.source !== "string" || typeof item.id !== "string" || !item.id) continue;
    out.push({
      source: item.source,
      id: item.id,
      version: typeof item.version === "string" ? item.version : null,
    });
  }
  return out;
}

function readQuestions(metadata: unknown): string[] {
  if (!isRecord(metadata) || !Array.isArray(metadata.suggested_questions)) return [];
  return metadata.suggested_questions.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function summarize(manifest: unknown): ManifestSummary {
  if (!isRecord(manifest)) return emptySummary();
  const summary = emptySummary();
  summary.model = typeof manifest.model === "string" ? manifest.model : "";
  summary.system = typeof manifest.system === "string" ? manifest.system : "";
  const tools = Array.isArray(manifest.tools) ? manifest.tools : [];
  const mcp: ManifestSummary["mcp"] = [];
  const custom: ManifestSummary["custom"] = [];
  let builtin: ManifestSummary["builtin"] = null;
  for (const item of tools) {
    if (!isRecord(item) || typeof item.type !== "string") continue;
    if (item.type === "agx_builtin") {
      if (builtin) continue;
      builtin = {
        defaultPolicy: readPolicy(item.default_policy, "always_allow"),
        overrides: readOverrides(item.configs),
      };
      continue;
    }
    if (item.type === "mcp" && typeof item.server === "string" && item.server) {
      mcp.push({
        server: item.server,
        transport: mcpTransport(manifest.mcp_servers, item.server),
        defaultPolicy: readPolicy(item.default_policy, "always_allow"),
        overrides: readOverrides(item.configs),
      });
      continue;
    }
    if (item.type === "custom" && typeof item.name === "string" && item.name) {
      custom.push({
        name: item.name,
        description: typeof item.description === "string" ? item.description : "",
      });
    }
  }
  summary.builtin = builtin;
  summary.mcp = mcp;
  summary.custom = custom;
  summary.skills = readSkills(manifest.skills);
  if (isRecord(manifest.runtime)) {
    const rounds = manifest.runtime.max_tool_rounds;
    if (typeof rounds === "number" && Number.isInteger(rounds) && rounds >= 1) summary.maxToolRounds = rounds;
  }
  if (isRecord(manifest.metadata)) {
    const welcome = manifest.metadata.welcome_message;
    summary.welcomeMessage = typeof welcome === "string" && welcome.trim() ? welcome : null;
  }
  summary.suggestedQuestions = readQuestions(manifest.metadata);
  return summary;
}

/** Never throws. Unknown shapes yield empty sections. Never copies mcp server urls. */
export function buildManifestSummary(manifest: unknown): ManifestSummary {
  try {
    return summarize(manifest);
  } catch {
    return emptySummary();
  }
}
