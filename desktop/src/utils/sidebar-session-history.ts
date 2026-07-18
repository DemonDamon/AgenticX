/** Pure helpers for left-sidebar session history (no React). */

import { META_AGENT_DISPLAY_NAME } from "../constants/branding";
import { isAutomationPaneAvatarId } from "./automation-pane";

export type SidebarSessionRow = {
  session_id: string;
  avatar_id: string | null;
  avatar_name?: string | null;
  session_name: string | null;
  updated_at: number;
  created_at?: number;
  pinned?: boolean;
  archived?: boolean;
  provider?: string;
  model?: string;
  session_mode?: "code_dev" | "daily_office";
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
    rows.push({
      session_id: sessionId,
      avatar_id: avatarId,
      avatar_name: row.avatar_name == null ? null : String(row.avatar_name),
      session_name: row.session_name == null ? null : String(row.session_name),
      updated_at: Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : 0,
      created_at: Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? createdAtRaw : undefined,
      pinned: Boolean(row.pinned),
      archived: Boolean(row.archived),
      provider: typeof row.provider === "string" ? row.provider : "",
      model: typeof row.model === "string" ? row.model : "",
      session_mode:
        row.session_mode === "code_dev" || row.session_mode === "daily_office"
          ? row.session_mode
          : undefined,
    });
  }
  return rows.sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const tsDiff = getSidebarSessionActivityTs(b) - getSidebarSessionActivityTs(a);
    if (tsDiff !== 0) return tsDiff;
    return b.session_id.localeCompare(a.session_id);
  });
}

export function resolveSidebarAvatarChipName(
  row: Pick<SidebarSessionRow, "avatar_id" | "avatar_name">,
  avatarNameById: Map<string, string>
): string {
  const aid = String(row.avatar_id ?? "").trim();
  if (!aid) return META_AGENT_DISPLAY_NAME;
  if (aid.startsWith("group:")) {
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

export function startOfLocalDay(d = new Date()): number {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x.getTime() / 1000;
}

export type SidebarHistoryBuckets = {
  pinned: SidebarSessionRow[];
  today: SidebarSessionRow[];
  earlier: SidebarSessionRow[];
};

/** Partition non-special rows into pinned / today / earlier. */
export function bucketSidebarHistoryRows(
  rows: readonly SidebarSessionRow[],
  specialIds: ReadonlySet<string>,
  nowSec = Date.now() / 1000
): SidebarHistoryBuckets {
  const todayStart = startOfLocalDay(new Date(nowSec * 1000));
  const pinned: SidebarSessionRow[] = [];
  const today: SidebarSessionRow[] = [];
  const earlier: SidebarSessionRow[] = [];
  for (const row of rows) {
    if (specialIds.has(row.session_id)) continue;
    if (row.pinned) {
      pinned.push(row);
      continue;
    }
    const ts = getSidebarSessionActivityTs(row);
    if (ts >= todayStart) today.push(row);
    else earlier.push(row);
  }
  return { pinned, today, earlier };
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
