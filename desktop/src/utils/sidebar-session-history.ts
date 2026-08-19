/** Pure helpers for left-sidebar session history (no React). */

import { META_AGENT_DISPLAY_NAME } from "../constants/branding";
import { isAutomationPaneAvatarId } from "./automation-pane";
import { visibleMessagesForSession, type OwnedMessage } from "./message-ownership";

export type SidebarSessionExecutionState = "idle" | "running" | "interrupted" | "failed";

export type SidebarSessionRow = {
  session_id: string;
  avatar_id: string | null;
  avatar_name?: string | null;
  session_name: string | null;
  /** Workspace explicitly active for the last turn (`default` means task). */
  active_taskspace_id?: string | null;
  /** Best-effort display label for the active project workspace. */
  active_taskspace_label?: string | null;
  updated_at: number;
  created_at?: number;
  pinned?: boolean;
  archived?: boolean;
  execution_state?: SidebarSessionExecutionState;
  provider?: string;
  model?: string;
  session_mode?: "code_dev" | "daily_office";
};

export type SidebarSessionHistoryHint = {
  activityAt: number;
  running: boolean;
};

const PLACEHOLDER_SESSION_TITLES = new Set(
  [
    "微信会话",
    "微信对话",
    "微信聊天",
    "飞书会话",
    "飞书对话",
    "新对话",
    "新会话",
    "new chat",
    "new conversation",
  ].map((s) => s.toLowerCase())
);

function sanitizeSessionDisplayText(input: string): string {
  const raw = String(input || "");
  if (!raw) return "";
  const withReasoningLabel = raw
    .replace(/<\s*think\s*>/gi, "思考：")
    .replace(/<\s*\/\s*think\s*>/gi, "");
  const compact = withReasoningLabel.replace(/\s+/g, " ").trim();
  if (compact === "思考：") return "";
  return compact;
}

function isPlaceholderSessionTitle(name: string): boolean {
  const t = sanitizeSessionDisplayText(name).trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (PLACEHOLDER_SESSION_TITLES.has(lower)) return true;
  if (t.startsWith("新会话") || t.startsWith("新对话")) return true;
  if (lower.startsWith("new session") || lower.startsWith("new chat")) return true;
  return false;
}

export function sidebarSessionLabel(item: Pick<SidebarSessionRow, "session_id" | "session_name">): string {
  const raw = sanitizeSessionDisplayText(item.session_name || "").trim();
  if (raw && !isPlaceholderSessionTitle(raw)) return raw;
  const compact = item.session_id.replace(/-/g, "");
  const hint = compact.slice(0, 8);
  return hint ? `·${hint}` : item.session_id.slice(0, 6);
}

export function getSidebarSessionActivityTs(row: Pick<SidebarSessionRow, "updated_at" | "created_at">): number {
  const updated = Number(row.updated_at ?? 0);
  if (Number.isFinite(updated) && updated > 0) return updated;
  const created = Number(row.created_at ?? 0);
  return Number.isFinite(created) && created > 0 ? created : 0;
}

/** Relative activity label for sidebar history rows (unix seconds). */
export function formatSidebarRelativeTime(tsSeconds: number, nowMs = Date.now()): string {
  const ts = Number(tsSeconds);
  if (!Number.isFinite(ts) || ts <= 0) return "";
  const diff = Math.max(0, nowMs / 1000 - ts);
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)} 天前`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))} 个月前`;
  return `${Math.floor(diff / (86400 * 365))} 年前`;
}

export function normalizeSidebarSessionRows(input: unknown): SidebarSessionRow[] {
  if (!Array.isArray(input)) return [];
  const rows: SidebarSessionRow[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const sessionId = String(row.session_id ?? "").trim();
    if (!sessionId) continue;
    const avatarId = row.avatar_id == null ? null : String(row.avatar_id);
    if (isAutomationPaneAvatarId(avatarId)) continue;
    if (Boolean(row.archived)) continue;
    const updatedAtRaw = Number(row.updated_at ?? 0);
    const createdAtRaw = Number(row.created_at ?? updatedAtRaw);
    const hasActiveTaskspaceId = Object.prototype.hasOwnProperty.call(row, "active_taskspace_id");
    const activeTaskspaceId = hasActiveTaskspaceId
      ? String(row.active_taskspace_id ?? "").trim() || null
      : undefined;
    const hasActiveTaskspaceLabel = Object.prototype.hasOwnProperty.call(row, "active_taskspace_label");
    const activeTaskspaceLabel = hasActiveTaskspaceLabel
      ? String(row.active_taskspace_label ?? "").trim() || null
      : undefined;
    const execRaw = String(row.execution_state ?? "idle").trim();
    const execution_state: SidebarSessionExecutionState =
      execRaw === "running" || execRaw === "interrupted" || execRaw === "failed"
        ? execRaw
        : "idle";
    rows.push({
      session_id: sessionId,
      avatar_id: avatarId,
      avatar_name: row.avatar_name == null ? null : String(row.avatar_name),
      session_name: row.session_name == null ? null : String(row.session_name),
      ...(hasActiveTaskspaceId ? { active_taskspace_id: activeTaskspaceId } : {}),
      ...(hasActiveTaskspaceLabel ? { active_taskspace_label: activeTaskspaceLabel } : {}),
      updated_at: Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : 0,
      created_at: Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? createdAtRaw : undefined,
      pinned: Boolean(row.pinned),
      archived: Boolean(row.archived),
      execution_state,
      provider: typeof row.provider === "string" ? row.provider : "",
      model: typeof row.model === "string" ? row.model : "",
      session_mode:
        row.session_mode === "code_dev" || row.session_mode === "daily_office"
          ? row.session_mode
          : undefined,
    });
  }
  return sortSidebarSessionRows(rows);
}

/**
 * A project is a session whose last explicit workspace is not the implicit
 * per-session `default` workspace. Missing metadata is intentionally treated
 * as a task so older sessions fail safe into the task list.
 */
export function isSidebarProjectRow(
  row: Pick<SidebarSessionRow, "active_taskspace_id">,
): boolean {
  const activeId = String(row.active_taskspace_id ?? "").trim();
  return activeId.length > 0 && activeId !== "default";
}

export function partitionSidebarSessionRows(
  rows: readonly SidebarSessionRow[],
): { projects: SidebarSessionRow[]; tasks: SidebarSessionRow[] } {
  const projects: SidebarSessionRow[] = [];
  const tasks: SidebarSessionRow[] = [];
  for (const row of rows) {
    (isSidebarProjectRow(row) ? projects : tasks).push(row);
  }
  return { projects, tasks };
}

/** Keep pin-first / activity-desc order after hint merge. */
export function sortSidebarSessionRows(rows: SidebarSessionRow[]): SidebarSessionRow[] {
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const tsDiff = getSidebarSessionActivityTs(b) - getSidebarSessionActivityTs(a);
    if (tsDiff !== 0) return tsDiff;
    return b.session_id.localeCompare(a.session_id);
  });
}

/**
 * Merge optimistic send hints into listed rows.
 * Once backend `updated_at` catches up, trust API `execution_state` (avoids stranded running).
 */
export function applySidebarSessionHistoryHints(
  rows: readonly SidebarSessionRow[],
  hints: Record<string, SidebarSessionHistoryHint>
): SidebarSessionRow[] {
  if (Object.keys(hints).length === 0) return [...rows];
  const mapped = rows.map((item) => {
    const hint = hints[item.session_id];
    if (!hint) return item;
    const apiActivity = Number(item.updated_at ?? 0);
    const backendCaughtUp = apiActivity >= hint.activityAt - 2;
    return {
      ...item,
      updated_at: Math.max(apiActivity, hint.activityAt),
      execution_state:
        !backendCaughtUp && hint.running
          ? ("running" as const)
          : item.execution_state ?? "idle",
    };
  });
  return sortSidebarSessionRows(mapped);
}

export function resolveSidebarAvatarChipName(
  row: Pick<SidebarSessionRow, "avatar_id" | "avatar_name">,
  avatarNameById: Map<string, string>
): string {
  const aid = String(row.avatar_id ?? "").trim();
  if (!aid) return META_AGENT_DISPLAY_NAME;
  if (aid.startsWith("group:")) {
    // Prefer live group registry name so every session of the same group
    // shares one chip (new sessions often omit avatar_name → used to show「群聊」).
    const fromMap = String(avatarNameById.get(aid) ?? "").trim();
    if (fromMap) return fromMap;
    const fromRow = String(row.avatar_name ?? "").trim();
    if (fromRow) return fromRow;
    return "群聊";
  }
  const fromMap = avatarNameById.get(aid);
  if (fromMap) return fromMap;
  const fromRow = String(row.avatar_name ?? "").trim();
  if (fromRow) return fromRow;
  return aid.slice(0, 8);
}

/** Sidebar `activeAvatarId` only tracks real avatars — never group/automation pane ids. */
export function activeAvatarIdForSidebarRow(avatarId: string | null | undefined): string | null {
  const aid = String(avatarId ?? "").trim();
  if (!aid) return null;
  if (aid.startsWith("group:") || aid.startsWith("automation:")) return null;
  return aid;
}

type SidebarPaneRef = {
  id: string;
  sessionId?: string;
  avatarId?: string | null;
};

/**
 * Resolve which pane should host a sidebar history open.
 * Prefer an existing pane already bound to the session (avoids hijacking a
 * same-avatar zombie pane), then fall back to avatar identity match.
 */
export function findPaneForSidebarSession(
  panes: ReadonlyArray<SidebarPaneRef>,
  row: Pick<SidebarSessionRow, "session_id" | "avatar_id">,
  forcePaneId?: string
): SidebarPaneRef | undefined {
  if (forcePaneId) {
    return panes.find((p) => p.id === forcePaneId);
  }
  const sid = String(row.session_id ?? "").trim();
  if (sid) {
    const bySession = panes.find((p) => String(p.sessionId ?? "").trim() === sid);
    if (bySession) return bySession;
  }
  const target = String(row.avatar_id ?? "").trim();
  return panes.find((p) => String(p.avatarId ?? "").trim() === target);
}

/**
 * Early-return is only safe when the pane already has *renderable* rows for
 * this session. Raw `messages.length > 0` is insufficient: untagged / wrong
 * `ownerSessionId` rows are filtered out and leave a blank chat (common on
 * group panes after stream/reattach), while "open in new tab" still works
 * because it bootstraps from disk into a fresh pane.
 */
export function sidebarSessionHasRenderableMessages(
  messages: ReadonlyArray<OwnedMessage>,
  sessionId: string
): boolean {
  return visibleMessagesForSession(messages, sessionId).length > 0;
}

export function startOfLocalDay(d = new Date()): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime() / 1000;
}

export type SidebarHistoryBuckets = {
  pinned: SidebarSessionRow[];
  today: SidebarSessionRow[];
  yesterday: SidebarSessionRow[];
  recent: SidebarSessionRow[];
  earlier: SidebarSessionRow[];
};

function startOfLocalDayDaysAgo(todayStartSec: number, daysAgo: number): number {
  const date = new Date(todayStartSec * 1000);
  date.setDate(date.getDate() - daysAgo);
  return date.getTime() / 1000;
}

/** Partition non-special rows by local calendar day; pinned rows never repeat in date buckets. */
export function bucketSidebarHistoryRows(
  rows: readonly SidebarSessionRow[],
  specialIds: ReadonlySet<string>,
  nowSec = Date.now() / 1000
): SidebarHistoryBuckets {
  const todayStart = startOfLocalDay(new Date(nowSec * 1000));
  const yesterdayStart = startOfLocalDayDaysAgo(todayStart, 1);
  const recentStart = startOfLocalDayDaysAgo(todayStart, 7);
  const pinned: SidebarSessionRow[] = [];
  const today: SidebarSessionRow[] = [];
  const yesterday: SidebarSessionRow[] = [];
  const recent: SidebarSessionRow[] = [];
  const earlier: SidebarSessionRow[] = [];
  for (const row of rows) {
    if (specialIds.has(row.session_id)) continue;
    if (row.pinned) {
      pinned.push(row);
      continue;
    }
    const ts = getSidebarSessionActivityTs(row);
    if (ts >= todayStart) today.push(row);
    else if (ts >= yesterdayStart) yesterday.push(row);
    else if (ts >= recentStart) recent.push(row);
    else earlier.push(row);
  }
  return { pinned, today, yesterday, recent, earlier };
}

/** Filter key: `"all"` | `"__meta__"` | avatar_id | `group:<id>` */
export function matchesSidebarAvatarFilter(
  row: Pick<SidebarSessionRow, "avatar_id">,
  filterAvatarId: string
): boolean {
  if (filterAvatarId === "all") return true;
  const rowAid = String(row.avatar_id ?? "").trim();
  if (filterAvatarId === "__meta__") return rowAid.length === 0;
  return rowAid === String(filterAvatarId ?? "").trim();
}

export function parseDesktopBoundSessionId(bindings: Record<string, unknown> | undefined): string {
  const desktop = bindings?.["_desktop"];
  if (!desktop || typeof desktop !== "object") return "";
  return String((desktop as Record<string, unknown>).session_id ?? "").trim();
}

export const SIDEBAR_HISTORY_PAGE_SIZE = 20;
export const SIDEBAR_HISTORY_FILTER_KEY = "agx-sidebar-history-avatar-filter-v1";
export const SIDEBAR_HISTORY_COLLAPSE_KEY = "agx-sidebar-history-collapse-v1";
