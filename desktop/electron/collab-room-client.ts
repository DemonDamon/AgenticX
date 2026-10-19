export type CollabRoomClientDeps = {
  baseUrl: string;
  token: string;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
};

export type CollabRoomEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

export type CollabRoomSseEvent = { type: string; data: unknown };

export type CollabRoomStreamHandlers = {
  onEvent: (event: CollabRoomSseEvent) => void;
  onClosed: (reason: string) => void;
};

const LOGIN_EXPIRED = "企业登录已失效，请重新登录";
const REMOVED = "你已被移出该房间";
const NOT_FOUND = "房间不存在";
const UNAVAILABLE = "云房间服务暂时不可用";

export function normalizePortalBase(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw.trim().replace(/\/+$/, "");
}

export function mapCollabRoomHttpError(status: number): string {
  if (status === 401) return LOGIN_EXPIRED;
  if (status === 403) return REMOVED;
  if (status === 404) return NOT_FOUND;
  return UNAVAILABLE;
}

function requestFetch(deps: CollabRoomClientDeps) {
  return deps.fetchImpl ?? ((input: string, init?: RequestInit) => fetch(input, init));
}

type RawEnvelope<T> = { ok: true; data: T } | { ok: false; error: string; status: number | null };

export function isCollabClientStatus(status: number | null): boolean {
  return typeof status === "number" && status >= 400 && status < 500;
}

export function isCollabUnavailableError(error: string): boolean {
  return error === UNAVAILABLE;
}

async function requestJsonRaw<T>(
  deps: CollabRoomClientDeps,
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<RawEnvelope<T>> {
  const base = normalizePortalBase(deps.baseUrl);
  if (!base) return { ok: false, error: UNAVAILABLE, status: null };
  try {
    const res = await requestFetch(deps)(`${base}${path}`, {
      ...init,
      headers: {
        authorization: `Bearer ${deps.token}`,
        accept: "application/json",
        ...(init.headers ?? {}),
      },
      signal: init.signal ?? AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, error: mapCollabRoomHttpError(res.status), status: res.status };
    const json = (await res.json()) as { data?: T };
    if (!json || typeof json !== "object" || json.data === undefined) {
      return { ok: false, error: UNAVAILABLE, status: null };
    }
    return { ok: true, data: json.data };
  } catch {
    return { ok: false, error: UNAVAILABLE, status: null };
  }
}

async function requestJson<T>(
  deps: CollabRoomClientDeps,
  path: string,
  init: RequestInit = {},
  timeoutMs = 15_000,
): Promise<CollabRoomEnvelope<T>> {
  const result = await requestJsonRaw<T>(deps, path, init, timeoutMs);
  if (result.ok) return result;
  return { ok: false, error: result.error };
}

export function listRooms(
  deps: CollabRoomClientDeps,
): Promise<CollabRoomEnvelope<{ rooms: unknown[] }>> {
  return requestJson(deps, "/api/desktop/rooms");
}

export function getRoom(
  deps: CollabRoomClientDeps,
  roomId: string,
): Promise<CollabRoomEnvelope<{ room: unknown; members: unknown[]; viewer_user_id?: string }>> {
  return requestJson(deps, `/api/desktop/rooms/${encodeURIComponent(roomId)}`);
}

export function listMessages(
  deps: CollabRoomClientDeps,
  roomId: string,
  opts: { afterSeq?: number; limit?: number } = {},
): Promise<CollabRoomEnvelope<{ messages: unknown[] }>> {
  const query = new URLSearchParams();
  if (typeof opts.afterSeq === "number") query.set("after_seq", String(opts.afterSeq));
  if (typeof opts.limit === "number") query.set("limit", String(opts.limit));
  const qs = query.toString();
  const suffix = qs ? `?${qs}` : "";
  return requestJson(deps, `/api/desktop/rooms/${encodeURIComponent(roomId)}/messages${suffix}`);
}

export function sendMessage(
  deps: CollabRoomClientDeps,
  roomId: string,
  content: string,
  clientMsgId?: string,
): Promise<RawEnvelope<{ message: unknown }>> {
  const body: { content: string; client_msg_id?: string } = { content };
  if (typeof clientMsgId === "string" && clientMsgId.trim()) body.client_msg_id = clientMsgId.trim();
  return requestJsonRaw(deps, `/api/desktop/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

export type CollabProjectSummary = {
  id: string;
  name: string;
  instructions: string;
  main_room_id: string;
  member_count: number;
  created_at: string;
  updated_at: string;
};

export type CollabProjectCreateInput = {
  name: string;
  instructions?: string;
  settings?: { connectors: string[]; experts: string[]; skills: string[] };
  member_user_ids?: { user_id: string; display_name: string }[];
};

function readStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const text = item.trim();
    if (text) items.push(text);
  }
  return items;
}

function asProjectSummary(value: unknown): CollabProjectSummary | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  const name = typeof row.name === "string" ? row.name.trim() : "";
  if (!id || !name) return null;
  return {
    id,
    name,
    instructions: typeof row.instructions === "string" ? row.instructions : "",
    main_room_id: typeof row.main_room_id === "string" ? row.main_room_id : "",
    member_count: typeof row.member_count === "number" ? row.member_count : 0,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
    updated_at: typeof row.updated_at === "string" ? row.updated_at : "",
  };
}

function readProjectSettings(
  value: unknown,
): CollabProjectCreateInput["settings"] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return {
    connectors: readStringList(record.connectors),
    experts: readStringList(record.experts),
    skills: readStringList(record.skills),
  };
}

function readProjectMembers(
  value: unknown,
): CollabProjectCreateInput["member_user_ids"] | undefined {
  if (!Array.isArray(value)) return undefined;
  const members: { user_id: string; display_name: string }[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as { user_id?: unknown; display_name?: unknown };
    const userId = typeof row.user_id === "string" ? row.user_id.trim() : "";
    const displayName = typeof row.display_name === "string" ? row.display_name.trim() : "";
    if (!userId || !displayName) continue;
    members.push({ user_id: userId, display_name: displayName });
  }
  return members;
}

export async function listProjects(
  deps: CollabRoomClientDeps,
): Promise<CollabRoomEnvelope<{ projects: CollabProjectSummary[] }>> {
  const result = await requestJson<{ projects?: unknown }>(deps, "/api/desktop/projects");
  if (!result.ok) return result;
  const projects = Array.isArray(result.data.projects)
    ? result.data.projects
        .map((item) => asProjectSummary(item))
        .filter((item): item is CollabProjectSummary => item !== null)
    : [];
  return { ok: true, data: { projects } };
}

export async function createProject(
  deps: CollabRoomClientDeps,
  input: CollabProjectCreateInput,
): Promise<CollabRoomEnvelope<{ project: CollabProjectSummary }>> {
  const settings = readProjectSettings(input.settings);
  const members = readProjectMembers(input.member_user_ids);
  const result = await requestJson<{ project?: unknown }>(deps, "/api/desktop/projects", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      ...(typeof input.instructions === "string" ? { instructions: input.instructions } : {}),
      ...(settings ? { settings } : {}),
      ...(members ? { member_user_ids: members } : {}),
    }),
  });
  if (!result.ok) return result;
  const project = asProjectSummary(result.data.project);
  if (!project) return { ok: false, error: UNAVAILABLE };
  return { ok: true, data: { project } };
}

export type CollabProjectDetail = CollabProjectSummary & {
  owner_user_id: string;
};

export type CollabProjectRoom = {
  id: string;
  title: string;
  parent_room_id: string | null;
  room_kind: string;
  member_count: number;
  last_seq: number;
  created_at: string;
};

export type CollabDirectoryUser = {
  id: string;
  display_name: string;
  email: string;
  dept_name: string;
};

export type CollabMergeMode = "all" | "selected" | "summary";

export type CollabMergeClientResult =
  | { pending: true; request_seq: number }
  | { pending: false; message: unknown };

function asProjectDetail(value: unknown): CollabProjectDetail | null {
  const base = asProjectSummary(value);
  if (!base || !value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  return {
    ...base,
    owner_user_id: typeof row.owner_user_id === "string" ? row.owner_user_id : "",
  };
}

function asProjectRoom(value: unknown): CollabProjectRoom | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;
  return {
    id,
    title: typeof row.title === "string" ? row.title : "",
    parent_room_id: typeof row.parent_room_id === "string" ? row.parent_room_id : null,
    room_kind: typeof row.room_kind === "string" ? row.room_kind : "room",
    member_count: typeof row.member_count === "number" ? row.member_count : 0,
    last_seq: typeof row.last_seq === "number" ? row.last_seq : 0,
    created_at: typeof row.created_at === "string" ? row.created_at : "",
  };
}

function asIdRecord(value: unknown): { id: string; title: string } | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;
  return { id, title: typeof row.title === "string" ? row.title : "" };
}

function asDirectoryUser(value: unknown): CollabDirectoryUser | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const id = typeof row.id === "string" ? row.id.trim() : "";
  if (!id) return null;
  return {
    id,
    display_name: typeof row.display_name === "string" ? row.display_name : "",
    email: typeof row.email === "string" ? row.email : "",
    dept_name: typeof row.dept_name === "string" ? row.dept_name : "",
  };
}

function readOptionalStrings(value: string[] | undefined): string[] | undefined {
  if (!value) return undefined;
  const items = value.map((item) => item.trim()).filter(Boolean);
  return items;
}

export async function getProject(
  deps: CollabRoomClientDeps,
  projectId: string,
): Promise<CollabRoomEnvelope<{ project: CollabProjectDetail; rooms: CollabProjectRoom[] }>> {
  const result = await requestJson<{ project?: unknown; rooms?: unknown }>(
    deps,
    `/api/desktop/projects/${encodeURIComponent(projectId)}`,
    { method: "GET" },
  );
  if (!result.ok) return result;
  const project = asProjectDetail(result.data.project);
  if (!project) return { ok: false, error: UNAVAILABLE };
  const rooms = Array.isArray(result.data.rooms)
    ? result.data.rooms.map((item) => asProjectRoom(item)).filter((item): item is CollabProjectRoom => item !== null)
    : [];
  return { ok: true, data: { project, rooms } };
}

export async function addProjectMember(
  deps: CollabRoomClientDeps,
  projectId: string,
  input: { user_id: string; display_name: string },
): Promise<CollabRoomEnvelope<{ member: unknown }>> {
  const result = await requestJson<{ member?: unknown }>(
    deps,
    `/api/desktop/projects/${encodeURIComponent(projectId)}/members`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        user_id: input.user_id.trim(),
        display_name: input.display_name.trim(),
      }),
    },
  );
  if (!result.ok) return result;
  if (!result.data.member || typeof result.data.member !== "object") {
    return { ok: false, error: UNAVAILABLE };
  }
  return { ok: true, data: { member: result.data.member } };
}

export async function openDirectRoom(
  deps: CollabRoomClientDeps,
  projectId: string,
  input: { peer_user_id: string; peer_display_name: string },
): Promise<CollabRoomEnvelope<{ room: { id: string; title: string } }>> {
  const result = await requestJson<{ room?: unknown }>(
    deps,
    `/api/desktop/projects/${encodeURIComponent(projectId)}/direct`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        peer_user_id: input.peer_user_id.trim(),
        peer_display_name: input.peer_display_name.trim(),
      }),
    },
  );
  if (!result.ok) return result;
  const room = asIdRecord(result.data.room);
  if (!room) return { ok: false, error: UNAVAILABLE };
  return { ok: true, data: { room } };
}

export async function createSubRoom(
  deps: CollabRoomClientDeps,
  parentRoomId: string,
  input: {
    title: string;
    member_user_ids: { user_id: string; display_name: string }[];
    agent_ids?: string[];
    seed_message_ids?: string[];
  },
): Promise<CollabRoomEnvelope<{ room: { id: string; title: string } }>> {
  const members = input.member_user_ids
    .map((member) => ({
      user_id: member.user_id.trim(),
      display_name: member.display_name.trim(),
    }))
    .filter((member) => member.user_id && member.display_name);
  const result = await requestJson<{ room?: unknown }>(
    deps,
    `/api/desktop/rooms/${encodeURIComponent(parentRoomId)}/sub-rooms`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: input.title.trim(),
        member_user_ids: members,
        ...(readOptionalStrings(input.agent_ids) ? { agent_ids: readOptionalStrings(input.agent_ids) } : {}),
        ...(readOptionalStrings(input.seed_message_ids)
          ? { seed_message_ids: readOptionalStrings(input.seed_message_ids) }
          : {}),
      }),
    },
  );
  if (!result.ok) return result;
  const room = asIdRecord(result.data.room);
  if (!room) return { ok: false, error: UNAVAILABLE };
  return { ok: true, data: { room } };
}

export async function mergeBack(
  deps: CollabRoomClientDeps,
  roomId: string,
  input: {
    target_room_id: string;
    mode: CollabMergeMode;
    message_ids?: string[];
    summary_text?: string;
  },
): Promise<CollabRoomEnvelope<CollabMergeClientResult>> {
  const result = await requestJson<{ pending?: unknown; request_seq?: unknown; message?: unknown }>(
    deps,
    `/api/desktop/rooms/${encodeURIComponent(roomId)}/merge`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        target_room_id: input.target_room_id.trim(),
        mode: input.mode,
        ...(input.message_ids ? { message_ids: input.message_ids } : {}),
        ...(typeof input.summary_text === "string" ? { summary_text: input.summary_text } : {}),
      }),
    },
  );
  if (!result.ok) return result;
  if (result.data.pending === true) {
    return {
      ok: true,
      data: {
        pending: true,
        request_seq: typeof result.data.request_seq === "number" ? result.data.request_seq : 0,
      },
    };
  }
  return { ok: true, data: { pending: false, message: result.data.message ?? null } };
}

export function approveMerge(
  deps: CollabRoomClientDeps,
  roomId: string,
  seq: number,
): Promise<CollabRoomEnvelope<{ message: unknown }>> {
  return requestJson(deps, `/api/desktop/rooms/${encodeURIComponent(roomId)}/merge/${seq}/approve`, {
    method: "POST",
  });
}

export async function summarizeRoom(
  deps: CollabRoomClientDeps,
  roomId: string,
  input: { message_ids?: string[] } = {},
): Promise<CollabRoomEnvelope<{ summary: string }>> {
  const result = await requestJson<{ summary?: unknown }>(
    deps,
    `/api/desktop/rooms/${encodeURIComponent(roomId)}/summarize`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input.message_ids ? { message_ids: input.message_ids } : {}),
    },
    60_000,
  );
  if (!result.ok) return result;
  if (typeof result.data.summary !== "string") return { ok: false, error: UNAVAILABLE };
  return { ok: true, data: { summary: result.data.summary } };
}

export async function searchDirectoryUsers(
  deps: CollabRoomClientDeps,
  q: string,
): Promise<CollabRoomEnvelope<{ users: CollabDirectoryUser[] }>> {
  const query = new URLSearchParams();
  query.set("q", q.trim());
  const result = await requestJson<{ users?: unknown }>(
    deps,
    `/api/desktop/directory/users?${query.toString()}`,
    { method: "GET" },
  );
  if (!result.ok) return result;
  if (!Array.isArray(result.data.users)) return { ok: false, error: UNAVAILABLE };
  const users = result.data.users
    .map((item) => asDirectoryUser(item))
    .filter((item): item is CollabDirectoryUser => item !== null);
  return { ok: true, data: { users } };
}

export function parseSseChunk(buffer: string): { events: CollabRoomSseEvent[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const events: CollabRoomSseEvent[] = [];
  let rest = normalized;
  while (true) {
    const sep = rest.indexOf("\n\n");
    if (sep < 0) break;
    const frame = rest.slice(0, sep);
    rest = rest.slice(sep + 2);
    if (!frame.trim()) continue;
    let type = "";
    const dataLines: string[] = [];
    for (const line of frame.split("\n")) {
      if (line.startsWith("event:")) type = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
    }
    if (!type) continue;
    const raw = dataLines.join("\n");
    let data: unknown = raw;
    try {
      data = JSON.parse(raw);
    } catch {
      /* keep raw string */
    }
    events.push({ type, data });
  }
  return { events, rest };
}

export async function streamRoomEvents(
  deps: CollabRoomClientDeps,
  roomId: string,
  handlers: CollabRoomStreamHandlers,
  signal: AbortSignal,
  afterSeq = 0,
): Promise<void> {
  const base = normalizePortalBase(deps.baseUrl);
  if (!base) {
    handlers.onClosed("error");
    return;
  }
  const url = `${base}/api/desktop/rooms/${encodeURIComponent(roomId)}/events?after_seq=${afterSeq}`;
  try {
    const res = await requestFetch(deps)(url, {
      headers: {
        authorization: `Bearer ${deps.token}`,
        accept: "text/event-stream",
      },
      signal,
    });
    if (!res.ok || !res.body) {
      handlers.onClosed(res.ok ? "end" : "error");
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parsed = parseSseChunk(buffer);
        buffer = parsed.rest;
        for (const event of parsed.events) handlers.onEvent(event);
      }
    } finally {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
    }
    handlers.onClosed(signal.aborted ? "aborted" : "end");
  } catch {
    handlers.onClosed(signal.aborted ? "aborted" : "error");
  }
}
