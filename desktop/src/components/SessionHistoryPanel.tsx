import { memo, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore, type ChatPane, type Message } from "../store";
import { isAutomationPaneAvatarId } from "../utils/automation-pane";
import { attachmentsFromSessionRow } from "../utils/session-message-map";
import { FeishuBadge } from "./FeishuBadge";

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

type Props = {
  pane: ChatPane;
  onClose?: () => void;
  tintColor?: string;
};

type SessionRow = {
  session_id: string;
  avatar_id: string | null;
  avatar_name?: string | null;
  session_name: string | null;
  updated_at: number;
  created_at?: number;
  pinned?: boolean;
  archived?: boolean;
};

type SessionContextMenu = {
  x: number;
  y: number;
  item: SessionRow;
};

type GroupedSessions = {
  pinned: SessionRow[];
  today: SessionRow[];
  previous7Days: SessionRow[];
  older: SessionRow[];
};

function getSessionCreatedTimestamp(row: SessionRow): number {
  const created = Number(row.created_at ?? 0);
  if (Number.isFinite(created) && created > 0) return created;
  const updated = Number(row.updated_at ?? 0);
  if (Number.isFinite(updated) && updated > 0) return updated;
  return 0;
}

function sortSessionRows(rows: SessionRow[]): SessionRow[] {
  return [...rows].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    const tsDiff = getSessionCreatedTimestamp(b) - getSessionCreatedTimestamp(a);
    if (tsDiff !== 0) return tsDiff;
    return b.session_id.localeCompare(a.session_id);
  });
}

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
  ].map((s) => s.toLowerCase()),
);

function isPlaceholderSessionTitle(name: string): boolean {
  const t = name.trim();
  if (!t) return true;
  const lower = t.toLowerCase();
  if (PLACEHOLDER_SESSION_TITLES.has(lower)) return true;
  if (t.startsWith("新会话") || t.startsWith("新对话")) return true;
  if (lower.startsWith("new session") || lower.startsWith("new chat")) return true;
  return false;
}

/** Title for history rows: real name, or short id — never generic 「新会话」. */
function sessionHistoryLabel(item: SessionRow): string {
  const raw = (item.session_name || "").trim();
  if (raw && !isPlaceholderSessionTitle(raw)) return raw;
  const compact = item.session_id.replace(/-/g, "");
  const hint = compact.slice(0, 8);
  return hint ? `·${hint}` : item.session_id.slice(0, 6);
}

/** English / 中文 aliases so e.g. "Feishu" matches 飞书 binding rows. */
function expandedSearchNeedles(query: string): string[] {
  const q = query.trim();
  if (!q) return [];
  const lower = q.toLowerCase();
  const needles = new Set<string>([q, lower]);
  const hasFeishu =
    /\bfeishu\b/i.test(q) || /\blark\b/i.test(q) || q.includes("飞书");
  const hasWechat =
    /\bwechat\b/i.test(q) || /\bweixin\b/i.test(q) || q.includes("微信");
  if (hasFeishu) {
    ["feishu", "lark", "飞书", "飞书绑定"].forEach((x) => needles.add(x.toLowerCase()));
  }
  if (hasWechat) {
    ["wechat", "weixin", "微信", "微信绑定"].forEach((x) => needles.add(x.toLowerCase()));
  }
  return Array.from(needles);
}

function sessionSearchHaystack(
  item: SessionRow,
  feishuSessionId: string | null,
  wechatSessionId: string | null
): string {
  const parts = [
    item.session_name,
    sessionHistoryLabel(item),
    item.avatar_name,
    item.session_id,
    item.session_id.replace(/-/g, ""),
    item.avatar_id,
  ]
    .filter((x): x is string => typeof x === "string" && x.length > 0)
    .join(" ");
  let extra = "";
  if (feishuSessionId && item.session_id === feishuSessionId) {
    extra += " 飞书 feishu lark 飞书绑定 绑定";
  }
  if (wechatSessionId && item.session_id === wechatSessionId) {
    extra += " 微信 wechat weixin 微信绑定 绑定";
  }
  return `${parts}${extra}`.toLowerCase();
}

function sessionMatchesQuery(
  item: SessionRow,
  needles: string[],
  feishuSessionId: string | null,
  wechatSessionId: string | null
): boolean {
  if (needles.length === 0) return true;
  const hay = sessionSearchHaystack(item, feishuSessionId, wechatSessionId);
  return needles.some((n) => {
    const t = n.trim();
    if (!t) return false;
    return hay.includes(t.toLowerCase());
  });
}

function buildHighlightTermsFromQuery(query: string): string[] {
  const raw = String(query || "").trim();
  if (!raw) return [];
  const terms = new Set<string>([raw]);
  for (const token of raw.split(/\s+/)) {
    const t = token.trim();
    if (t.length >= 2) terms.add(t);
  }
  return Array.from(terms);
}

function normalizeSessionRows(input: unknown): SessionRow[] {
  if (!Array.isArray(input)) return [];
  const rows: SessionRow[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const sessionId = String(row.session_id ?? "").trim();
    if (!sessionId) continue;
    const avatarId = row.avatar_id == null ? null : String(row.avatar_id);
    const avatarName = row.avatar_name == null ? null : String(row.avatar_name);
    const sessionName = row.session_name == null ? null : String(row.session_name);
    const updatedAtRaw = Number(row.updated_at ?? 0);
    const createdAtRaw = Number(row.created_at ?? updatedAtRaw);
    rows.push({
      session_id: sessionId,
      avatar_id: avatarId,
      avatar_name: avatarName,
      session_name: sessionName,
      updated_at: Number.isFinite(updatedAtRaw) && updatedAtRaw > 0 ? updatedAtRaw : Date.now() / 1000,
      created_at: Number.isFinite(createdAtRaw) && createdAtRaw > 0 ? createdAtRaw : undefined,
      pinned: Boolean(row.pinned),
      archived: Boolean(row.archived),
    });
  }
  return sortSessionRows(rows);
}

export const SessionHistoryPanel = memo(function SessionHistoryPanel({ pane, onClose, tintColor }: Props) {
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const setPaneMessages = useAppStore((s) => s.setPaneMessages);
  const setPaneHistorySearchTerms = useAppStore((s) => s.setPaneHistorySearchTerms);
  const addPane = useAppStore((s) => s.addPane);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [feishuBoundSessionId, setFeishuBoundSessionId] = useState<string | null>(null);
  const [wechatBoundSessionId, setWechatBoundSessionId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [contextMenu, setContextMenu] = useState<SessionContextMenu | null>(null);
  const [unreadSessionIds, setUnreadSessionIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);
  const [sessionSearchQuery, setSessionSearchQuery] = useState("");
  const [messageSearchSnippets, setMessageSearchSnippets] = useState<Record<string, string>>({});
  const messageSearchReq = useRef(0);

  const title = useMemo(() => (pane.avatarName || "Machi").trim(), [pane.avatarName]);

  const feishuMarkedSessionId = useMemo(() => {
    if (isAutomationPaneAvatarId(pane.avatarId)) return null;
    const sid = feishuBoundSessionId;
    if (!sid) return null;
    const row = sessions.find((s) => s.session_id === sid);
    if (row && isAutomationPaneAvatarId(row.avatar_id)) return null;
    return sid;
  }, [pane.avatarId, feishuBoundSessionId, sessions]);

  const wechatMarkedSessionId = useMemo(() => {
    if (isAutomationPaneAvatarId(pane.avatarId)) return null;
    const sid = wechatBoundSessionId;
    if (!sid) return null;
    const row = sessions.find((s) => s.session_id === sid);
    if (row && isAutomationPaneAvatarId(row.avatar_id)) return null;
    return sid;
  }, [pane.avatarId, wechatBoundSessionId, sessions]);

  const sessionSearchTrim = sessionSearchQuery.trim();
  const sessionSearchNeedles = useMemo(
    () => expandedSearchNeedles(sessionSearchTrim),
    [sessionSearchTrim]
  );

  const sessionsMatchingSearch = useMemo(() => {
    if (!sessionSearchTrim) return sessions;
    const contentHitIds = new Set(Object.keys(messageSearchSnippets));
    return sessions.filter(
      (item) =>
        sessionMatchesQuery(item, sessionSearchNeedles, feishuMarkedSessionId, wechatMarkedSessionId) ||
        contentHitIds.has(item.session_id)
    );
  }, [
    sessions,
    sessionSearchTrim,
    sessionSearchNeedles,
    feishuMarkedSessionId,
    wechatMarkedSessionId,
    messageSearchSnippets,
  ]);

  const groupedSessions = useMemo<GroupedSessions>(() => {
    const pool = sessionsMatchingSearch;
    const specialIds = new Set<string>();
    if (feishuMarkedSessionId) specialIds.add(feishuMarkedSessionId);
    if (wechatMarkedSessionId) specialIds.add(wechatMarkedSessionId);
    const visibleSessions = specialIds.size > 0
      ? pool.filter((item) => !specialIds.has(item.session_id))
      : pool;
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const startPrevious7Days = startToday - 7 * 24 * 3600;
    const grouped: GroupedSessions = {
      pinned: [],
      today: [],
      previous7Days: [],
      older: [],
    };
    for (const item of visibleSessions) {
      if (item.pinned) {
        grouped.pinned.push(item);
        continue;
      }
      const createdAt = getSessionCreatedTimestamp(item);
      if (createdAt >= startToday) {
        grouped.today.push(item);
      } else if (createdAt >= startPrevious7Days) {
        grouped.previous7Days.push(item);
      } else {
        grouped.older.push(item);
      }
    }
    return grouped;
  }, [sessionsMatchingSearch, feishuMarkedSessionId, wechatMarkedSessionId]);

  const loadSessions = async () => {
    try {
      const avatarId = pane.avatarId ?? undefined;
      const result = await window.agenticxDesktop.listSessions(avatarId);
      if (!result.ok) return;
      const rows = normalizeSessionRows(result.sessions);
      setSessions(rows);
      setUnreadSessionIds((prev) => prev.filter((id) => rows.some((r) => r.session_id === id)));
      setSelectedSessionIds((prev) => prev.filter((id) => rows.some((r) => r.session_id === id)));
    } catch (err) {
      console.error("[SessionHistoryPanel] loadSessions error:", err);
    }
  };

  useEffect(() => {
    if (!pane.historyOpen) return;
    void loadSessions();
  }, [pane.historyOpen, pane.avatarId, pane.sessionId]);

  useEffect(() => {
    if (!pane.historyOpen) setSessionSearchQuery("");
  }, [pane.historyOpen]);

  useEffect(() => {
    if (!pane.historyOpen) return;
    if (!sessionSearchTrim) {
      setMessageSearchSnippets({});
      return;
    }
    setMessageSearchSnippets({});
    const myId = ++messageSearchReq.current;
    const handle = window.setTimeout(() => {
      void (async () => {
        try {
          const avatarRaw = pane.avatarId;
          const avatarId =
            typeof avatarRaw === "string" && avatarRaw.length > 0 ? avatarRaw : undefined;
          const res = await window.agenticxDesktop.searchSessions({
            q: sessionSearchTrim,
            avatarId,
          });
          if (myId !== messageSearchReq.current) return;
          const next: Record<string, string> = {};
          const hits = Array.isArray(res.hits) ? res.hits : [];
          for (const h of hits) {
            const sid = String(h.session_id || "").trim();
            if (!sid) continue;
            const snip = String(h.snippet || "").trim();
            next[sid] = snip || "（消息命中）";
          }
          setMessageSearchSnippets(next);
        } catch {
          if (myId !== messageSearchReq.current) return;
          setMessageSearchSnippets({});
        }
      })();
    }, 320);
    return () => window.clearTimeout(handle);
  }, [pane.historyOpen, sessionSearchTrim, pane.avatarId]);

  useEffect(() => {
    if (!pane.historyOpen) return;
    let cancelled = false;

    const syncFeishuBinding = async () => {
      if (cancelled) return;
      try {
        const r = await window.agenticxDesktop.loadFeishuBinding();
        if (!r.ok || cancelled) {
          if (!cancelled) setFeishuBoundSessionId(null);
          return;
        }
        const desk = r.bindings["_desktop"] as { session_id?: string; avatar_id?: string | null } | undefined;
        if (isAutomationPaneAvatarId(desk?.avatar_id)) {
          await window.agenticxDesktop.saveFeishuDesktopBinding({ sessionId: null });
          if (!cancelled) setFeishuBoundSessionId(null);
          return;
        }
        const sid = typeof desk?.session_id === "string" ? desk.session_id.trim() : "";
        setFeishuBoundSessionId(sid || null);
      } catch {
        if (!cancelled) {
          setFeishuBoundSessionId(null);
        }
      }
    };

    const syncWechatBinding = async () => {
      if (cancelled) return;
      try {
        const r = await window.agenticxDesktop.loadWechatBinding();
        if (!r.ok || cancelled) {
          if (!cancelled) setWechatBoundSessionId(null);
          return;
        }
        const desk = r.bindings["_desktop"] as { session_id?: string; avatar_id?: string | null } | undefined;
        if (isAutomationPaneAvatarId(desk?.avatar_id)) {
          await window.agenticxDesktop.saveWechatDesktopBinding({ sessionId: null });
          if (!cancelled) setWechatBoundSessionId(null);
          return;
        }
        const sid = typeof desk?.session_id === "string" ? desk.session_id.trim() : "";
        setWechatBoundSessionId(sid || null);
      } catch {
        if (!cancelled) {
          setWechatBoundSessionId(null);
        }
      }
    };

    void syncFeishuBinding();
    void syncWechatBinding();
    const timer = window.setInterval(() => {
      void syncFeishuBinding();
      void syncWechatBinding();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [pane.historyOpen]);

  useEffect(() => {
    if (!contextMenu) return;
    if (selectMode) {
      setContextMenu(null);
      return;
    }
    const closeMenu = () => setContextMenu(null);
    window.addEventListener("click", closeMenu);
    window.addEventListener("blur", closeMenu);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("blur", closeMenu);
    };
  }, [contextMenu, selectMode]);

  // --- All hooks above, conditional render below ---

  if (!pane.historyOpen) return null;

  const feishuSession = feishuMarkedSessionId
    ? sessions.find((item) => item.session_id === feishuMarkedSessionId) ??
      ({
        session_id: feishuMarkedSessionId,
        avatar_id: pane.avatarId ?? null,
        avatar_name: pane.avatarName ?? null,
        session_name: null,
        updated_at: Date.now() / 1000,
        created_at: Date.now() / 1000,
      } satisfies SessionRow)
    : null;

  const wechatSession = wechatMarkedSessionId
    ? sessions.find((item) => item.session_id === wechatMarkedSessionId) ??
      ({
        session_id: wechatMarkedSessionId,
        avatar_id: pane.avatarId ?? null,
        avatar_name: pane.avatarName ?? null,
        session_name: null,
        updated_at: Date.now() / 1000,
        created_at: Date.now() / 1000,
      } satisfies SessionRow)
    : null;

  const switchSession = async (sessionId: string, targetPaneId = pane.id, highlightTerms: string[] = []) => {
    setPaneSessionId(targetPaneId, sessionId);
    setPaneHistorySearchTerms(targetPaneId, highlightTerms);
    setUnreadSessionIds((prev) => prev.filter((id) => id !== sessionId));
    try {
      const result = await window.agenticxDesktop.loadSessionMessages(sessionId);
      if (result.ok && Array.isArray(result.messages)) {
        const mapped: Message[] = result.messages.map((item, index) => {
          const storedId = item.id != null ? String(item.id).trim() : "";
          const id = `${sessionId}-i${index}${storedId ? `-${storedId}` : ""}`;
          return {
          id,
          role: item.role,
          content: item.content,
          agentId: item.agent_id ?? "meta",
          avatarName: item.avatar_name,
          avatarUrl: item.avatar_url,
          provider: item.provider,
          model: item.model,
          quotedMessageId: item.quoted_message_id,
          quotedContent: item.quoted_content,
          timestamp: typeof item.timestamp === "number" ? item.timestamp : undefined,
          attachments: attachmentsFromSessionRow(item.attachments),
          forwardedHistory: item.forwarded_history
            ? {
                title: String(item.forwarded_history.title || "").trim() || "聊天记录",
                sourceSession: String(item.forwarded_history.source_session || "").trim(),
                items: Array.isArray(item.forwarded_history.items)
                  ? item.forwarded_history.items.map((entry) => ({
                      sender: String(entry.sender || "").trim() || "unknown",
                      role: String(entry.role || "").trim() || "assistant",
                      content: String(entry.content || ""),
                      avatarUrl: String(entry.avatar_url || "").trim() || undefined,
                      timestamp: typeof entry.timestamp === "number" ? entry.timestamp : undefined,
                    }))
                  : [],
              }
            : undefined,
        };
        });
        setPaneMessages(targetPaneId, mapped);
        return;
      }
    } catch {
      /* fallback below */
    }
    setPaneMessages(targetPaneId, []);
  };

  const saveRename = async (sessionId: string) => {
    const name = editingName.trim();
    if (!name) {
      setEditingId(null);
      return;
    }
    await window.agenticxDesktop.renameSession({ sessionId, name });
    setSessions((prev) =>
      prev.map((item) => (item.session_id === sessionId ? { ...item, session_name: name } : item))
    );
    setEditingId(null);
  };

  const toggleSelectSession = (sessionId: string) => {
    setSelectedSessionIds((prev) =>
      prev.includes(sessionId) ? prev.filter((id) => id !== sessionId) : [...prev, sessionId]
    );
  };

  const toggleSelectAll = () => {
    const pool = sessionsMatchingSearch;
    setSelectedSessionIds((prev) => {
      if (prev.length >= pool.length && pool.length > 0) return [];
      return pool.map((s) => s.session_id);
    });
  };

  const deleteSelectedSessions = async () => {
    const api = window.agenticxDesktop;
    if (typeof api.deleteSession !== "function") return;
    const targets = selectedSessionIds.filter(Boolean);
    if (targets.length === 0) return;
    const confirmed = window.confirm(`确认删除已选择的 ${targets.length} 个会话？删除后不可恢复。`);
    if (!confirmed) return;
    const prevSessions = sessions;
    const remainingSessions = sessions.filter((row) => !targets.includes(row.session_id));
    // Optimistic UI: remove selected rows immediately so interaction feels instant.
    setSessions(remainingSessions);
    setSelectedSessionIds([]);
    setBatchDeleting(true);
    try {
      let pending = [...targets];
      for (let round = 0; round < 3 && pending.length > 0; round += 1) {
        let failedRound: string[] = [];
        const canBatch = typeof api.deleteSessionsBatch === "function";
        if (canBatch) {
          const result = await api.deleteSessionsBatch(pending);
          const batchFailed = Array.isArray(result.failed) ? result.failed : [];
          if (!result?.ok) {
            // Fallback to single-delete when batch endpoint is unavailable or errored.
            for (const sessionId of pending) {
              try {
                const single = await api.deleteSession(sessionId);
                if (!single?.ok) failedRound.push(sessionId);
              } catch {
                failedRound.push(sessionId);
              }
            }
          } else {
            failedRound = batchFailed;
          }
        } else {
          for (const sessionId of pending) {
            try {
              const result = await api.deleteSession(sessionId);
              if (!result?.ok) failedRound.push(sessionId);
            } catch {
              failedRound.push(sessionId);
            }
          }
        }

        // Verify against latest server list: anything still present must be retried.
        const refresh = await api.listSessions(pane.avatarId ?? undefined);
        const rows = refresh.ok ? normalizeSessionRows(refresh.sessions) : [];
        const remainSet = new Set(rows.map((row) => row.session_id));
        const stillThere = pending.filter((sid) => remainSet.has(sid));
        const retrySet = new Set([...failedRound, ...stillThere]);
        pending = Array.from(retrySet);
      }

      const failed = pending;
      if (failed.length > 0) {
        // Restore failed rows; keep successful deletes hidden.
        const failedSet = new Set(failed);
        setSessions((curr) => {
          const existing = new Set(curr.map((row) => row.session_id));
          const toRestore = prevSessions.filter((row) => failedSet.has(row.session_id) && !existing.has(row.session_id));
          return sortSessionRows([...curr, ...toRestore]);
        });
        window.alert(`有 ${failed.length} 个会话删除失败，已自动保留。你可以再次尝试删除。`);
      }
      const activeDeleted = targets.includes(pane.sessionId);
      await loadSessions();
      if (activeDeleted) {
        const refresh = await window.agenticxDesktop.listSessions(pane.avatarId ?? undefined);
        const rows = refresh.ok ? normalizeSessionRows(refresh.sessions) : [];
        const next = rows.find((row) => !targets.includes(row.session_id));
        if (next) {
          await switchSession(next.session_id);
        } else {
          try {
            const avatarId =
              pane.avatarId && pane.avatarId.startsWith("group:") ? undefined : pane.avatarId ?? undefined;
            const created = await window.agenticxDesktop.createSession({ avatar_id: avatarId });
            if (created.ok && created.session_id) {
              setPaneSessionId(pane.id, created.session_id);
              setPaneMessages(pane.id, []);
              await loadSessions();
            } else {
              setPaneSessionId(pane.id, "");
              setPaneMessages(pane.id, []);
            }
          } catch {
            setPaneSessionId(pane.id, "");
            setPaneMessages(pane.id, []);
          }
        }
      }
      setSelectMode(false);
    } finally {
      setBatchDeleting(false);
    }
  };

  const renderSessionItem = (item: SessionRow, contentSnippet?: string) => {
    if (!item || !item.session_id) return null;
    const active = item.session_id === pane.sessionId;
    const label = sessionHistoryLabel(item);
    const unread = unreadSessionIds.includes(item.session_id);
    const createdAt = getSessionCreatedTimestamp(item) || Date.now() / 1000;
    const feishuMarked = feishuMarkedSessionId === item.session_id;
    const wechatMarked = wechatMarkedSessionId === item.session_id;
    return (
      <div key={item.session_id} className="mb-1">
        {editingId === item.session_id ? (
          <input
            autoFocus
            value={editingName}
            onChange={(e) => setEditingName(e.target.value)}
            onBlur={() => void saveRename(item.session_id)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveRename(item.session_id);
              if (e.key === "Escape") setEditingId(null);
            }}
            className="w-full rounded border border-border-strong bg-surface-hover px-2 py-1 text-xs text-text-primary outline-none"
          />
        ) : (
          <button
            className={`flex w-full flex-col items-start rounded px-2 py-1 text-left text-xs transition ${
              active ? "bg-surface-hover font-medium text-text-strong" : "text-text-muted hover:bg-surface-hover"
            }`}
            onClick={() => {
              if (selectMode) {
                toggleSelectSession(item.session_id);
                return;
              }
              const terms = buildHighlightTermsFromQuery(sessionSearchTrim);
              void switchSession(item.session_id, pane.id, terms);
            }}
            onDoubleClick={() => {
              if (selectMode) return;
              setEditingId(item.session_id);
              setEditingName(label);
            }}
            onContextMenu={(e) => {
              if (selectMode) return;
              e.preventDefault();
              setContextMenu({ x: e.clientX, y: e.clientY, item });
            }}
            title={selectMode ? "点击勾选会话" : "双击重命名 / 右键打开菜单"}
          >
            <span className="flex w-full items-center gap-1.5 truncate">
              {selectMode ? (
                <input
                  type="checkbox"
                  checked={selectedSessionIds.includes(item.session_id)}
                  onChange={() => toggleSelectSession(item.session_id)}
                  className="h-3 w-3 accent-neutral-400"
                  onClick={(e) => e.stopPropagation()}
                />
              ) : null}
              {item.pinned ? <span className="text-[10px] text-amber-300">pin</span> : null}
              <span className="truncate">{label}</span>
              {feishuMarked ? (
                <FeishuBadge />
              ) : null}
              {wechatMarked ? (
                <span
                  className="inline-flex shrink-0 items-center rounded-sm px-1 py-px text-[9px] font-medium leading-tight"
                  style={{ backgroundColor: "rgba(37,211,102,0.15)", color: "#25D366" }}
                >
                  微信
                </span>
              ) : null}
              {unread ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-muted" /> : null}
            </span>
            {contentSnippet ? (
              <span className="mt-0.5 line-clamp-2 w-full text-[9px] leading-snug text-text-subtle" title={contentSnippet}>
                {contentSnippet}
              </span>
            ) : null}
            <span className="mt-0.5 truncate w-full text-[9px] text-text-faint">
              {timeAgo(createdAt)}
            </span>
          </button>
        )}
      </div>
    );
  };

  const renderGroup = (groupTitle: string, items: SessionRow[]) => {
    if (items.length === 0) return null;
    return (
      <div className="mb-2">
        <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-text-faint">{groupTitle}</div>
        {items.map((item) =>
          renderSessionItem(
            item,
            sessionSearchTrim ? messageSearchSnippets[item.session_id] : undefined
          )
        )}
      </div>
    );
  };

  const runContextAction = async (action: string) => {
    if (!contextMenu) return;
    const item = contextMenu.item;
    setContextMenu(null);
    if (action === "toggle_feishu_binding") {
      if (isAutomationPaneAvatarId(pane.avatarId) || isAutomationPaneAvatarId(item.avatar_id)) return;
      const currentBound = (feishuBoundSessionId || "").trim();
      const target = (item.session_id || "").trim();
      if (!target) return;
      if (currentBound === target) {
        await window.agenticxDesktop.saveFeishuDesktopBinding({ sessionId: null });
        setFeishuBoundSessionId(null);
      } else {
        const aid = (item.avatar_id || "").trim();
        await window.agenticxDesktop.saveFeishuDesktopBinding({
          sessionId: target,
          avatarId: aid.startsWith("group:") ? null : (aid || null),
          avatarName: item.avatar_name || null,
        });
        setFeishuBoundSessionId(target);
      }
      return;
    }
    if (action === "toggle_wechat_binding") {
      if (isAutomationPaneAvatarId(pane.avatarId) || isAutomationPaneAvatarId(item.avatar_id)) return;
      const currentBound = (wechatBoundSessionId || "").trim();
      const target = (item.session_id || "").trim();
      if (!target) return;
      if (currentBound === target) {
        await window.agenticxDesktop.saveWechatDesktopBinding({ sessionId: null });
        setWechatBoundSessionId(null);
      } else {
        const aid = (item.avatar_id || "").trim();
        await window.agenticxDesktop.saveWechatDesktopBinding({
          sessionId: target,
          avatarId: aid.startsWith("group:") ? null : (aid || null),
          avatarName: item.avatar_name || null,
        });
        setWechatBoundSessionId(target);
      }
      return;
    }
    if (action === "rename") {
      const label = sessionHistoryLabel(item);
      setEditingId(item.session_id);
      setEditingName(label);
      return;
    }
    if (action === "pin") {
      const api = window.agenticxDesktop;
      if (typeof api.pinSession === "function") {
        await api.pinSession({ sessionId: item.session_id, pinned: !item.pinned });
        await loadSessions();
      }
      return;
    }
    if (action === "open_new_tab") {
      const paneId = addPane(item.avatar_id ?? null, item.avatar_name || "Machi", item.session_id);
      const terms = buildHighlightTermsFromQuery(sessionSearchTrim);
      await switchSession(item.session_id, paneId, terms);
      return;
    }
    if (action === "mark_unread") {
      setUnreadSessionIds((prev) =>
        prev.includes(item.session_id) ? prev.filter((id) => id !== item.session_id) : [...prev, item.session_id]
      );
      return;
    }
    if (action === "fork") {
      const api = window.agenticxDesktop;
      if (typeof api.forkSession === "function") {
        const result = await api.forkSession({ sessionId: item.session_id });
        if (result.ok) await loadSessions();
      }
      return;
    }
    if (action === "delete") {
      const api = window.agenticxDesktop;
      if (typeof api.deleteSession !== "function") return;
      const confirmed = window.confirm("确认删除该会话？删除后不可恢复。");
      if (!confirmed) return;
      const result = await api.deleteSession(item.session_id);
      if (result.ok) {
        await loadSessions();
        if (pane.sessionId === item.session_id) {
          const next = sessions.find((row) => row.session_id !== item.session_id);
          if (next) {
            await switchSession(next.session_id);
          } else {
            try {
              const avatarId =
                pane.avatarId && pane.avatarId.startsWith("group:") ? undefined : pane.avatarId ?? undefined;
              const created = await window.agenticxDesktop.createSession({ avatar_id: avatarId });
              if (created.ok && created.session_id) {
                setPaneSessionId(pane.id, created.session_id);
                setPaneMessages(pane.id, []);
                await loadSessions();
              } else {
                setPaneSessionId(pane.id, "");
                setPaneMessages(pane.id, []);
              }
            } catch {
              setPaneSessionId(pane.id, "");
              setPaneMessages(pane.id, []);
            }
          }
        }
      }
      return;
    }
    if (action === "archive_prior") {
      const api = window.agenticxDesktop;
      if (typeof api.archiveSessions !== "function") return;
      const confirmed = window.confirm("确认归档当前会话之前的历史会话吗？");
      if (!confirmed) return;
      const result = await api.archiveSessions({
        sessionId: item.session_id,
        avatarId: pane.avatarId ?? item.avatar_id ?? null,
      });
      if (result.ok) {
        await loadSessions();
      }
    }
  };

  const showFeishuBindSection =
    !!feishuSession &&
    (!sessionSearchTrim ||
      sessionMatchesQuery(
        feishuSession,
        sessionSearchNeedles,
        feishuMarkedSessionId,
        wechatMarkedSessionId
      ) ||
      Boolean(sessionSearchTrim && messageSearchSnippets[feishuSession.session_id]));
  const showWechatBindSection =
    !!wechatSession &&
    (!sessionSearchTrim ||
      sessionMatchesQuery(
        wechatSession,
        sessionSearchNeedles,
        feishuMarkedSessionId,
        wechatMarkedSessionId
      ) ||
      Boolean(sessionSearchTrim && messageSearchSnippets[wechatSession.session_id]));

  const searchHasAnyMatch =
    !sessionSearchTrim ||
    showFeishuBindSection ||
    showWechatBindSection ||
    groupedSessions.pinned.length +
      groupedSessions.today.length +
      groupedSessions.previous7Days.length +
      groupedSessions.older.length >
      0;

  return (
    <div
      className="flex h-full w-[220px] shrink-0 flex-col border-l border-border bg-surface-card"
      style={tintColor ? { backgroundColor: tintColor } : undefined}
    >
      <div className="shrink-0 border-b border-border px-3 py-2 text-xs text-text-subtle">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" className="shrink-0" title={title}>
              <path d="M2.5 3C2.5 2.17 3.17 1.5 4 1.5H12C12.83 1.5 13.5 2.17 13.5 3V9C13.5 9.83 12.83 10.5 12 10.5H9L6.5 13V10.5H4C3.17 10.5 2.5 9.83 2.5 9V3Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round"/>
              <path d="M5 5H11M5 7.5H9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
            </svg>
          </span>
          <div className="flex items-center gap-1">
            {!selectMode ? (
              <button
                className="rounded border border-border px-1.5 py-0.5 text-text-muted hover:bg-surface-hover"
                onClick={() => {
                  setSelectMode(true);
                  setContextMenu(null);
                }}
                title="多选会话"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <rect x="2" y="2" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                  <rect x="2" y="9" width="5" height="5" rx="1" stroke="currentColor" strokeWidth="1.3"/>
                  <path d="M9 4.5H14M9 11.5H14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
                </svg>
              </button>
            ) : (
              <>
                <button
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover"
                  onClick={toggleSelectAll}
                  disabled={batchDeleting}
                  title="全选或取消全选"
                >
                  {selectedSessionIds.length >= sessionsMatchingSearch.length && sessionsMatchingSearch.length > 0
                    ? "取消全选"
                    : "全选"}
                </button>
                <button
                  className="rounded border border-red-500/50 px-2 py-0.5 text-[11px] text-red-300 hover:bg-red-500/10 disabled:opacity-50"
                  onClick={() => void deleteSelectedSessions()}
                  disabled={batchDeleting || selectedSessionIds.length === 0}
                  title={selectedSessionIds.length > 0 ? `删除 ${selectedSessionIds.length} 个会话` : "先勾选会话"}
                >
                  {batchDeleting ? "删除中..." : `删除${selectedSessionIds.length > 0 ? ` (${selectedSessionIds.length})` : ""}`}
                </button>
                <button
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover"
                  onClick={() => {
                    setSelectMode(false);
                    setSelectedSessionIds([]);
                  }}
                  disabled={batchDeleting}
                >
                  取消
                </button>
              </>
            )}
            {onClose ? (
              <button
                className="rounded px-1.5 py-0.5 text-[11px] text-text-faint hover:bg-surface-hover hover:text-text-muted"
                onClick={onClose}
                title="关闭历史会话"
              >
                <svg width="10" height="10" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 8H13" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round"/>
                </svg>
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <div className="shrink-0 px-2 pt-2">
        <input
          type="search"
          value={sessionSearchQuery}
          onChange={(e) => setSessionSearchQuery(e.target.value)}
          placeholder="Search Sessions..."
          autoComplete="off"
          spellCheck={false}
          aria-label="搜索历史会话"
          className="w-full rounded-md border border-border bg-surface-hover px-2 py-1.5 text-[11px] text-text-primary placeholder:text-text-faint focus:border-[var(--ui-btn-primary-border,#3b82f6)] focus:outline-none focus:ring-1 focus:ring-[var(--ui-btn-primary-border,#3b82f6)]"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {sessions.length === 0 ? (
          <div className="rounded border border-dashed border-border p-2 text-center text-xs text-text-faint">
            暂无会话
          </div>
        ) : !searchHasAnyMatch ? (
          <div className="rounded border border-dashed border-border p-2 text-center text-xs text-text-faint">
            未找到匹配会话
          </div>
        ) : (
          <>
            {showFeishuBindSection && feishuSession ? (
              <div className="mb-2">
                <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[#3370FF]">
                  <span>飞书绑定</span>
                  <span
                    className="inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 py-px text-[9px] font-medium leading-tight"
                    style={{ backgroundColor: "rgba(51,112,255,0.15)", color: "#3370FF" }}
                  >
                    唯一
                  </span>
                </div>
                {renderSessionItem(
                  feishuSession,
                  sessionSearchTrim ? messageSearchSnippets[feishuSession.session_id] : undefined
                )}
              </div>
            ) : null}
            {showWechatBindSection && wechatSession ? (
              <div className="mb-2">
                <div className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium uppercase tracking-wide text-[#25D366]">
                  <span>微信绑定</span>
                  <span
                    className="inline-flex shrink-0 items-center gap-0.5 rounded-sm px-1 py-px text-[9px] font-medium leading-tight"
                    style={{ backgroundColor: "rgba(37,211,102,0.15)", color: "#25D366" }}
                  >
                    唯一
                  </span>
                </div>
                {renderSessionItem(
                  wechatSession,
                  sessionSearchTrim ? messageSearchSnippets[wechatSession.session_id] : undefined
                )}
              </div>
            ) : null}
            {renderGroup("Pinned", groupedSessions.pinned)}
            {renderGroup("Today", groupedSessions.today)}
            {renderGroup("Previous 7 days", groupedSessions.previous7Days)}
            {renderGroup("Older", groupedSessions.older)}
          </>
        )}
      </div>
      {contextMenu ? (
        <div
          className="fixed z-50 min-w-[180px] rounded-md border border-border bg-surface-panel p-1 shadow-2xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => void runContextAction("pin")}
          >
            {contextMenu.item.pinned ? "取消置顶" : "置顶"}
          </button>
          {!isAutomationPaneAvatarId(pane.avatarId) && !isAutomationPaneAvatarId(contextMenu.item.avatar_id) ? (
            <>
              <button
                className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
                onClick={() => void runContextAction("toggle_feishu_binding")}
              >
                {feishuBoundSessionId === contextMenu.item.session_id ? "取消绑定飞书会话" : "绑定为飞书会话"}
              </button>
              <button
                className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
                onClick={() => void runContextAction("toggle_wechat_binding")}
              >
                {wechatBoundSessionId === contextMenu.item.session_id ? "取消绑定微信会话" : "绑定为微信会话"}
              </button>
            </>
          ) : null}
          <button
            className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => void runContextAction("fork")}
          >
            分叉会话
          </button>
          <button
            className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => void runContextAction("open_new_tab")}
          >
            在新标签打开
          </button>
          <button
            className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => void runContextAction("mark_unread")}
          >
            标记未读
          </button>
          <div className="my-1 border-t border-border" />
          <button
            className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => void runContextAction("delete")}
          >
            删除
          </button>
          <button
            className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => void runContextAction("rename")}
          >
            重命名
          </button>
          <button
            className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => void runContextAction("archive_prior")}
          >
            归档此前会话
          </button>
        </div>
      ) : null}
    </div>
  );
});
