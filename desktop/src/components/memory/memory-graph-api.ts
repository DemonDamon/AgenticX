import type {
  GraphEpisodeDTO,
  GraphViewDTO,
  MemoryGraphScope,
  MemoryGraphStatus,
  WorkspaceMemoryDoc,
} from "./memory-graph-types";

function headers(token: string): HeadersInit {
  return {
    "x-agx-desktop-token": token,
    "Content-Type": "application/json",
  };
}

/**
 * 带超时的 fetch：后端图谱引擎初始化/被占用时 HTTP 可能长时间不返回，
 * 无超时会让 UI 永久停在「加载图谱…」。超时后抛出可读错误交给上层展示。
 */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error(
        "后端无响应（超时）：图谱引擎可能正在初始化或被其他 agx serve 占用，请完全退出 Near 后重开",
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// Graphiti/Kuzu 只接受 [字母数字 _ -]，必须与后端 group_id.py 的编码完全一致
function safeGroupPart(part: string): string {
  return part.replace(/[^0-9A-Za-z_-]/g, "_");
}

export function deriveGroupId(
  scope: MemoryGraphScope,
  avatarId: string | null,
): string {
  if (scope === "meta") return "meta_default";
  const aid = (avatarId || "").trim();
  if (scope === "group") {
    const gid = aid.startsWith("group:") ? aid.slice("group:".length) : aid;
    const safe = safeGroupPart(gid);
    return safe ? `group_${safe}` : "";
  }
  // avatar 作用域：群聊 pane(group:*)/空 avatar 不属于分身分区
  if (!aid || aid.startsWith("group:")) return "";
  return `avatar_${safeGroupPart(aid)}`;
}

function appendGroupContext(
  qs: URLSearchParams,
  params: {
    scope: MemoryGraphScope;
    avatarId: string | null;
    sessionId: string;
    groupId?: string;
  },
): void {
  if (params.groupId) qs.set("group_id", params.groupId);
  qs.set("scope", params.scope);
  if (params.avatarId) qs.set("avatar_id", params.avatarId);
  if (params.sessionId.trim()) qs.set("session_id", params.sessionId.trim());
}

export function formatMemoryGraphFetchError(error: unknown, fallback: string): string {
  const msg = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed/i.test(msg)) {
    return "无法连接 agx serve（后端可能无响应或正初始化图谱引擎，请完全退出 Near 后重开）";
  }
  return msg || fallback;
}

function formatMemoryGraphApiError(
  body: unknown,
  fallback: string,
): string {
  const detail = (body as { detail?: unknown })?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const err = detail as { error?: string; message?: string };
    const code = err.error || "";
    if (code === "group_access_denied") {
      return "无权访问该记忆分区（请确认当前窗格会话与所选范围一致）";
    }
    const message = err.message || "";
    if (/kuzu|lock on file|图谱库被占用/i.test(message)) {
      return message;
    }
    return err.message || code || fallback;
  }
  return fallback;
}

export function isMemoryGraphEnabled(status: MemoryGraphStatus): boolean {
  if (typeof status.config?.enabled === "boolean") return status.config.enabled;
  return Boolean(status.enabled);
}

export async function fetchMemoryGraphStatus(
  apiBase: string,
  apiToken: string,
): Promise<MemoryGraphStatus> {
  const r = await fetchWithTimeout(
    `${apiBase}/api/memory/graph/status`,
    { headers: headers(apiToken) },
    15000,
  );
  if (!r.ok) throw new Error(`status ${r.status}`);
  return (await r.json()) as MemoryGraphStatus;
}

export async function fetchMemoryGraphOverview(
  apiBase: string,
  apiToken: string,
  params: {
    scope: MemoryGraphScope;
    avatarId: string | null;
    sessionId: string;
    groupId?: string;
  },
): Promise<GraphViewDTO> {
  const qs = new URLSearchParams();
  appendGroupContext(qs, params);
  const r = await fetchWithTimeout(
    `${apiBase}/api/memory/graph/overview?${qs}`,
    { headers: headers(apiToken) },
    30000,
  );
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(formatMemoryGraphApiError(body, `overview ${r.status}`));
  }
  const data = (await r.json()) as GraphViewDTO & { ok?: boolean };
  return { nodes: data.nodes || [], edges: data.edges || [], meta: data.meta };
}

export async function fetchMemoryGraphEpisodes(
  apiBase: string,
  apiToken: string,
  groupId: string,
  lastN = 20,
  context?: {
    scope?: MemoryGraphScope;
    avatarId?: string | null;
    sessionId?: string;
  },
): Promise<GraphEpisodeDTO[]> {
  const qs = new URLSearchParams({ group_id: groupId, last_n: String(lastN) });
  if (context?.scope) qs.set("scope", context.scope);
  if (context?.avatarId) qs.set("avatar_id", context.avatarId);
  if (context?.sessionId?.trim()) qs.set("session_id", context.sessionId.trim());
  const r = await fetchWithTimeout(
    `${apiBase}/api/memory/graph/episodes?${qs}`,
    { headers: headers(apiToken) },
    20000,
  );
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(formatMemoryGraphApiError(body, `episodes ${r.status}`));
  }
  const data = (await r.json()) as { episodes?: GraphEpisodeDTO[] };
  return data.episodes || [];
}

export async function searchMemoryGraph(
  apiBase: string,
  apiToken: string,
  groupId: string,
  query: string,
  sessionId: string,
  avatarId: string | null,
): Promise<GraphViewDTO> {
  const r = await fetchWithTimeout(
    `${apiBase}/api/memory/graph/search`,
    {
      method: "POST",
      headers: headers(apiToken),
      body: JSON.stringify({
        group_id: groupId,
        query,
        session_id: sessionId,
        avatar_id: avatarId,
      }),
    },
    30000,
  );
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(formatMemoryGraphApiError(body, `search ${r.status}`));
  }
  const data = (await r.json()) as GraphViewDTO;
  return data;
}

export async function deleteMemoryGraphEpisode(
  apiBase: string,
  apiToken: string,
  episodeId: string,
  groupId: string,
  sessionId: string,
  avatarId: string | null,
): Promise<void> {
  const qs = new URLSearchParams({
    group_id: groupId,
    session_id: sessionId,
  });
  if (avatarId) qs.set("avatar_id", avatarId);
  const r = await fetch(`${apiBase}/api/memory/graph/episode/${encodeURIComponent(episodeId)}?${qs}`, {
    method: "DELETE",
    headers: headers(apiToken),
  });
  if (!r.ok) throw new Error(`delete ${r.status}`);
}

export async function fetchMemoryGraphConfig(
  apiBase: string,
  apiToken: string,
): Promise<Record<string, unknown>> {
  const r = await fetchWithTimeout(
    `${apiBase}/api/memory/graph/config`,
    { headers: headers(apiToken) },
    15000,
  );
  if (!r.ok) throw new Error(`config ${r.status}`);
  const data = (await r.json()) as { config?: Record<string, unknown> };
  return data.config || {};
}

export async function updateMemoryGraphConfig(
  apiBase: string,
  apiToken: string,
  config: Record<string, unknown>,
): Promise<void> {
  const r = await fetchWithTimeout(
    `${apiBase}/api/memory/graph/config`,
    {
      method: "PUT",
      headers: headers(apiToken),
      body: JSON.stringify({ config }),
    },
    15000,
  );
  if (!r.ok) throw new Error(`config ${r.status}`);
}

export async function fetchWorkspaceMemory(
  apiBase: string,
  apiToken: string,
  avatarId?: string | null,
): Promise<WorkspaceMemoryDoc> {
  const qs = avatarId?.trim() ? `?avatar_id=${encodeURIComponent(avatarId.trim())}` : "";
  const r = await fetch(`${apiBase}/api/memory/workspace${qs}`, { headers: headers(apiToken) });
  if (!r.ok) throw new Error(`workspace memory ${r.status}`);
  const data = (await r.json()) as Partial<WorkspaceMemoryDoc>;
  return { sections: data.sections || [], path: data.path || "" };
}

function workspaceEntryBody(
  body: Record<string, unknown>,
  avatarId?: string | null,
): Record<string, unknown> {
  const aid = avatarId?.trim();
  return aid ? { ...body, avatar_id: aid } : body;
}

export async function createWorkspaceEntry(
  apiBase: string,
  apiToken: string,
  section: string,
  text: string,
  avatarId?: string | null,
): Promise<void> {
  const r = await fetch(`${apiBase}/api/memory/workspace/entry`, {
    method: "POST",
    headers: headers(apiToken),
    body: JSON.stringify(workspaceEntryBody({ section, text }, avatarId)),
  });
  if (!r.ok) throw new Error(`create entry ${r.status}`);
}

export async function updateWorkspaceEntry(
  apiBase: string,
  apiToken: string,
  section: string,
  index: number,
  text: string,
  children?: string[],
  avatarId?: string | null,
): Promise<void> {
  const body: { section: string; index: number; text: string; children?: string[] } = {
    section,
    index,
    text,
  };
  if (children !== undefined) body.children = children;
  const r = await fetch(`${apiBase}/api/memory/workspace/entry`, {
    method: "PATCH",
    headers: headers(apiToken),
    body: JSON.stringify(workspaceEntryBody(body, avatarId)),
  });
  if (!r.ok) throw new Error(`update entry ${r.status}`);
}

export async function deleteWorkspaceEntry(
  apiBase: string,
  apiToken: string,
  section: string,
  index: number,
  avatarId?: string | null,
): Promise<void> {
  const r = await fetch(`${apiBase}/api/memory/workspace/entry`, {
    method: "DELETE",
    headers: headers(apiToken),
    body: JSON.stringify(workspaceEntryBody({ section, index }, avatarId)),
  });
  if (!r.ok) throw new Error(`delete entry ${r.status}`);
}

export type WorkspaceEntryRef = { section: string; index: number };

export async function deleteWorkspaceEntriesBatch(
  apiBase: string,
  apiToken: string,
  entries: WorkspaceEntryRef[],
  avatarId?: string | null,
): Promise<number> {
  const r = await fetch(`${apiBase}/api/memory/workspace/entries/batch-delete`, {
    method: "POST",
    headers: headers(apiToken),
    body: JSON.stringify(workspaceEntryBody({ entries }, avatarId)),
  });
  if (!r.ok) throw new Error(`batch delete entries ${r.status}`);
  const data = (await r.json()) as { deleted?: number };
  return typeof data.deleted === "number" ? data.deleted : entries.length;
}
