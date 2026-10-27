import { studioFetch } from "./studio-fetch";

export const MANAGED_PANE_PREFIX = "ma:";
export const MA_LAST_SESSION_KEY = "agx-ma-last-session-v1";
export const MA_LAST_SESSION_MAX = 100;
const DETAIL_TTL_MS = 60_000;
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export type EnterpriseAgentCard = {
  id: string;
  displayName: string;
  description: string | null;
  runtime: "cloud" | "desktop_worker";
  model: string;
  origin: "enterprise" | "employee";
  latestVersion: number;
  effectiveVersion: number;
  routingMode: "follow_latest" | "pinned";
  defaultEnvironment: { id: string; name: string; type: "cloud" | "desktop_worker" } | null;
  executionTarget: "cloud" | "desktop_worker";
  ownedByMe: boolean;
};

export type ManifestOverrideView = {
  name: string;
  policy: "always_allow" | "always_ask" | null;
  enabled: boolean;
};

export type ManifestSummaryView = {
  model: string;
  system: string;
  builtin: { defaultPolicy: "always_allow" | "always_ask"; overrides: ManifestOverrideView[] } | null;
  mcp: Array<{
    server: string;
    transport: string;
    defaultPolicy: "always_allow" | "always_ask";
    overrides: ManifestOverrideView[];
  }>;
  custom: Array<{ name: string; description: string }>;
  skills: Array<{ source: string; id: string; version: string | null }>;
  maxToolRounds: number | null;
  welcomeMessage: string | null;
  suggestedQuestions: string[];
};

export type EnterpriseAgentDetail = {
  agent: EnterpriseAgentCard;
  version: {
    version: number;
    createdAt: string;
    note: string | null;
    summary: ManifestSummaryView;
  };
};

type LastSessionRow = { sessionId: string; updatedAt: number };
type DetailCacheEntry = { at: number; detail: EnterpriseAgentDetail };

const detailCache = new Map<string, DetailCacheEntry>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRuntime(value: unknown): "cloud" | "desktop_worker" {
  return value === "desktop_worker" ? "desktop_worker" : "cloud";
}

function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

function parseEnvironment(value: unknown): EnterpriseAgentCard["defaultEnvironment"] {
  if (!isRecord(value)) return null;
  if (typeof value.status === "string" && value.status !== "active") return null;
  const id = typeof value.id === "string" ? value.id : "";
  const name = typeof value.name === "string" ? value.name : "";
  if (!id || !name) return null;
  if (value.type !== "cloud" && value.type !== "desktop_worker") return null;
  return { id, name, type: value.type };
}

export function isManagedPaneAvatarId(avatarId: string | null | undefined): boolean {
  if (!avatarId?.startsWith(MANAGED_PANE_PREFIX)) return false;
  return ULID_RE.test(avatarId.slice(MANAGED_PANE_PREFIX.length));
}

export function managedPaneAvatarId(agentId: string): string {
  return `${MANAGED_PANE_PREFIX}${agentId}`;
}

export function managedAgentIdOf(avatarId: string | null | undefined): string | null {
  if (!isManagedPaneAvatarId(avatarId)) return null;
  return String(avatarId).slice(MANAGED_PANE_PREFIX.length);
}

export function executionLabelKey(
  target: "cloud" | "desktop_worker",
): "gallery.enterprise.cloud" | "gallery.enterprise.desktop" {
  switch (target) {
    case "cloud":
      return "gallery.enterprise.cloud";
    case "desktop_worker":
      return "gallery.enterprise.desktop";
    default: {
      const neverTarget: never = target;
      return neverTarget;
    }
  }
}

export function parseEnterpriseAgents(raw: unknown): EnterpriseAgentCard[] {
  const agents = isRecord(raw) ? raw.agents : null;
  if (!Array.isArray(agents)) return [];
  const cards: EnterpriseAgentCard[] = [];
  for (const item of agents) {
    if (!isRecord(item)) continue;
    const id = typeof item.id === "string" ? item.id : "";
    const displayName = typeof item.displayName === "string" ? item.displayName : "";
    if (!id || !displayName) continue;
    const runtime = asRuntime(item.runtime);
    const defaultEnvironment = parseEnvironment(item.defaultEnvironment);
    const executionTarget = item.executionTarget === "cloud" || item.executionTarget === "desktop_worker"
      ? item.executionTarget
      : (defaultEnvironment?.type ?? runtime);
    cards.push({
      id,
      displayName,
      description: typeof item.description === "string" ? item.description : null,
      runtime,
      model: typeof item.model === "string" ? item.model : "",
      origin: item.origin === "employee" ? "employee" : "enterprise",
      latestVersion: positiveInt(item.latestVersion) ?? 1,
      effectiveVersion: positiveInt(item.effectiveVersion) ?? 1,
      routingMode: item.routingMode === "pinned" ? "pinned" : "follow_latest",
      defaultEnvironment,
      executionTarget,
      ownedByMe: item.ownedByMe === true,
    });
  }
  return cards;
}

function emptySummary(): ManifestSummaryView {
  return {
    model: "",
    system: "",
    builtin: null,
    mcp: [],
    custom: [],
    skills: [],
    maxToolRounds: null,
    welcomeMessage: null,
    suggestedQuestions: [],
  };
}

function readPolicy(value: unknown): "always_allow" | "always_ask" {
  return value === "always_ask" ? "always_ask" : "always_allow";
}

function readOverrides(value: unknown): ManifestOverrideView[] {
  if (!Array.isArray(value)) return [];
  const overrides: ManifestOverrideView[] = [];
  for (const item of value) {
    if (!isRecord(item) || typeof item.name !== "string" || !item.name) continue;
    const policy = item.policy === "always_allow" || item.policy === "always_ask" || item.policy === null
      ? item.policy
      : null;
    overrides.push({
      name: item.name,
      policy,
      enabled: item.enabled !== false,
    });
  }
  return overrides;
}

function parseSummary(raw: unknown): ManifestSummaryView {
  if (!isRecord(raw)) return emptySummary();
  const summary = emptySummary();
  summary.model = typeof raw.model === "string" ? raw.model : "";
  summary.system = typeof raw.system === "string" ? raw.system : "";
  if (isRecord(raw.builtin)) {
    summary.builtin = {
      defaultPolicy: readPolicy(raw.builtin.defaultPolicy),
      overrides: readOverrides(raw.builtin.overrides),
    };
  }
  if (Array.isArray(raw.mcp)) {
    for (const item of raw.mcp) {
      if (!isRecord(item) || typeof item.server !== "string" || !item.server) continue;
      summary.mcp.push({
        server: item.server,
        transport: item.transport === "sse" ? "sse" : "http",
        defaultPolicy: readPolicy(item.defaultPolicy),
        overrides: readOverrides(item.overrides),
      });
    }
  }
  if (Array.isArray(raw.custom)) {
    for (const item of raw.custom) {
      if (!isRecord(item) || typeof item.name !== "string" || !item.name) continue;
      summary.custom.push({
        name: item.name,
        description: typeof item.description === "string" ? item.description : "",
      });
    }
  }
  if (Array.isArray(raw.skills)) {
    for (const item of raw.skills) {
      if (!isRecord(item) || typeof item.id !== "string" || !item.id) continue;
      summary.skills.push({
        source: typeof item.source === "string" ? item.source : "",
        id: item.id,
        version: typeof item.version === "string" ? item.version : null,
      });
    }
  }
  summary.maxToolRounds = typeof raw.maxToolRounds === "number" ? raw.maxToolRounds : null;
  summary.welcomeMessage = typeof raw.welcomeMessage === "string" && raw.welcomeMessage.trim()
    ? raw.welcomeMessage
    : null;
  if (Array.isArray(raw.suggestedQuestions)) {
    summary.suggestedQuestions = raw.suggestedQuestions.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0,
    );
  }
  return summary;
}

export function parseEnterpriseAgentDetail(raw: unknown): EnterpriseAgentDetail | null {
  if (!isRecord(raw)) return null;
  const agent = parseEnterpriseAgents({ agents: [raw.agent] })[0];
  if (!agent) return null;
  const version = isRecord(raw.version) ? raw.version : {};
  return {
    agent,
    version: {
      version: positiveInt(version.version) ?? agent.effectiveVersion,
      createdAt: typeof version.createdAt === "string" ? version.createdAt : "",
      note: typeof version.note === "string" ? version.note : null,
      summary: parseSummary(version.summary),
    },
  };
}

export function clearEnterpriseAgentDetailCache(): void {
  detailCache.clear();
}

export async function loadEnterpriseAgentDetail(
  agentId: string,
  opts?: { force?: boolean; now?: number },
): Promise<{ ok: true; detail: EnterpriseAgentDetail } | { ok: false; status: number }> {
  const now = opts?.now ?? Date.now();
  if (!opts?.force) {
    const hit = detailCache.get(agentId);
    if (hit && now - hit.at < DETAIL_TTL_MS) return { ok: true, detail: hit.detail };
  }
  let token = "";
  try {
    token = (await window.agenticxDesktop.getApiAuthToken()) || "";
  } catch {
    token = "";
  }
  let response: Response;
  try {
    response = await studioFetch(`/api/enterprise-agents/${agentId}`, { apiToken: token });
  } catch {
    return { ok: false, status: 0 };
  }
  if (!response.ok) return { ok: false, status: response.status };
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return { ok: false, status: response.status };
  }
  const detail = parseEnterpriseAgentDetail(body);
  if (!detail) return { ok: false, status: response.status };
  detailCache.set(agentId, { at: now, detail });
  return { ok: true, detail };
}

function readLastSessions(storage: Storage): Record<string, LastSessionRow> {
  try {
    const raw = storage.getItem(MA_LAST_SESSION_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};
    const out: Record<string, LastSessionRow> = {};
    for (const [agentId, value] of Object.entries(parsed)) {
      if (!isRecord(value) || typeof value.sessionId !== "string" || !value.sessionId) continue;
      out[agentId] = {
        sessionId: value.sessionId,
        updatedAt: typeof value.updatedAt === "number" ? value.updatedAt : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

function writeLastSessions(storage: Storage, rows: Record<string, LastSessionRow>): void {
  const trimmed = Object.entries(rows)
    .sort((left, right) => right[1].updatedAt - left[1].updatedAt)
    .slice(0, MA_LAST_SESSION_MAX);
  storage.setItem(MA_LAST_SESSION_KEY, JSON.stringify(Object.fromEntries(trimmed)));
}

export function getLastManagedSession(agentId: string, storage: Storage = localStorage): string | null {
  const row = readLastSessions(storage)[agentId];
  return row?.sessionId ?? null;
}

export function rememberManagedSession(
  agentId: string,
  sessionId: string,
  storage: Storage = localStorage,
  now: () => number = Date.now,
): void {
  if (!agentId || !sessionId) return;
  const rows = readLastSessions(storage);
  rows[agentId] = { sessionId, updatedAt: now() };
  writeLastSessions(storage, rows);
}

export function forgetManagedSession(agentId: string, storage: Storage = localStorage): void {
  const rows = readLastSessions(storage);
  if (!(agentId in rows)) return;
  delete rows[agentId];
  writeLastSessions(storage, rows);
}
