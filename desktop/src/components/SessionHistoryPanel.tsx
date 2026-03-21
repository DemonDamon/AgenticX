import { memo, useEffect, useMemo, useState } from "react";
import { useAppStore, type ChatPane, type Message } from "../store";

function timeAgo(ts: number): string {
  const diff = Date.now() / 1000 - ts;
  if (diff < 60) return "刚刚";
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

type Props = {
  pane: ChatPane;
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

export const SessionHistoryPanel = memo(function SessionHistoryPanel({ pane }: Props) {
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const setPaneMessages = useAppStore((s) => s.setPaneMessages);
  const addPane = useAppStore((s) => s.addPane);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const [contextMenu, setContextMenu] = useState<SessionContextMenu | null>(null);
  const [unreadSessionIds, setUnreadSessionIds] = useState<string[]>([]);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedSessionIds, setSelectedSessionIds] = useState<string[]>([]);
  const [batchDeleting, setBatchDeleting] = useState(false);

  const title = useMemo(() => (pane.avatarName || "Meta-Agent").trim(), [pane.avatarName]);

  const groupedSessions = useMemo<GroupedSessions>(() => {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() / 1000;
    const startPrevious7Days = startToday - 7 * 24 * 3600;
    const grouped: GroupedSessions = {
      pinned: [],
      today: [],
      previous7Days: [],
      older: [],
    };
    for (const item of sessions) {
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
  }, [sessions]);

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

  const switchSession = async (sessionId: string, targetPaneId = pane.id) => {
    setPaneSessionId(targetPaneId, sessionId);
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
    setSelectedSessionIds((prev) => {
      if (prev.length >= sessions.length && sessions.length > 0) return [];
      return sessions.map((s) => s.session_id);
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

  const renderSessionItem = (item: SessionRow) => {
    if (!item || !item.session_id) return null;
    const active = item.session_id === pane.sessionId;
    const label = (item.session_name || "").trim() || `新会话 ${item.session_id.slice(0, 6)}`;
    const unread = unreadSessionIds.includes(item.session_id);
    const createdAt = getSessionCreatedTimestamp(item) || Date.now() / 1000;
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
              void switchSession(item.session_id);
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
              {unread ? <span className="inline-block h-1.5 w-1.5 rounded-full bg-text-muted" /> : null}
            </span>
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
        {items.map((item) => renderSessionItem(item))}
      </div>
    );
  };

  const runContextAction = async (action: string) => {
    if (!contextMenu) return;
    const item = contextMenu.item;
    setContextMenu(null);
    if (action === "rename") {
      const label = (item.session_name || "").trim() || `新会话 ${item.session_id.slice(0, 6)}`;
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
      const paneId = addPane(item.avatar_id ?? null, item.avatar_name || "Meta-Agent", item.session_id);
      await switchSession(item.session_id, paneId);
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

  return (
    <div className="h-full w-[220px] shrink-0 border-l border-border bg-surface-card">
      <div className="border-b border-border px-3 py-2 text-xs text-text-subtle">
        <div className="flex items-center justify-between gap-2">
          <span>{title} · 历史会话</span>
          {!selectMode ? (
            <button
              className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover"
              onClick={() => {
                setSelectMode(true);
                setContextMenu(null);
              }}
            >
              选择
            </button>
          ) : (
            <div className="flex items-center gap-1">
              <button
                className="rounded border border-border px-2 py-0.5 text-[11px] text-text-muted hover:bg-surface-hover"
                onClick={toggleSelectAll}
                disabled={batchDeleting}
                title="全选或取消全选"
              >
                {selectedSessionIds.length >= sessions.length && sessions.length > 0 ? "取消全选" : "全选"}
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
            </div>
          )}
        </div>
      </div>
      <div className="max-h-[calc(100%-35px)] overflow-y-auto px-2 py-2">
        {sessions.length === 0 ? (
          <div className="rounded border border-dashed border-border p-2 text-center text-xs text-text-faint">
            暂无会话
          </div>
        ) : (
          <>
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
            {contextMenu.item.pinned ? "Unpin" : "Pin"}
          </button>
          <button
            className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => void runContextAction("fork")}
          >
            Fork Chat
          </button>
          <button
            className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => void runContextAction("open_new_tab")}
          >
            Open in New Tab
          </button>
          <button
            className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => void runContextAction("mark_unread")}
          >
            Mark as Unread
          </button>
          <div className="my-1 border-t border-border" />
          <button
            className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => void runContextAction("delete")}
          >
            Delete
          </button>
          <button
            className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => void runContextAction("rename")}
          >
            Rename
          </button>
          <button
            className="w-full rounded px-2 py-1.5 text-left text-xs text-text-primary hover:bg-surface-hover"
            onClick={() => void runContextAction("archive_prior")}
          >
            Archive Prior Chats
          </button>
        </div>
      ) : null}
    </div>
  );
});
