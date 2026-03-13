import { useEffect, useMemo, useState } from "react";
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

export function SessionHistoryPanel({ pane }: Props) {
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const setPaneMessages = useAppStore((s) => s.setPaneMessages);
  const [sessions, setSessions] = useState<
    Array<{ session_id: string; avatar_id: string | null; session_name: string | null; updated_at: number }>
  >([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  const title = useMemo(() => (pane.avatarName || "Meta-Agent").trim(), [pane.avatarName]);

  useEffect(() => {
    if (!pane.historyOpen) return;
    const avatarId = pane.avatarId ?? undefined;
    void window.agenticxDesktop.listSessions(avatarId).then((result) => {
      if (!result.ok || !Array.isArray(result.sessions)) return;
      setSessions(result.sessions);
    });
  }, [pane.historyOpen, pane.avatarId, pane.sessionId]);

  if (!pane.historyOpen) return null;

  const switchSession = async (sessionId: string) => {
    setPaneSessionId(pane.id, sessionId);
    try {
      const result = await window.agenticxDesktop.loadSessionMessages(sessionId);
      if (result.ok && Array.isArray(result.messages)) {
        const mapped: Message[] = result.messages.map((item) => ({
          id: `${sessionId}-${item.id ?? Math.random().toString(16).slice(2)}`,
          role: item.role,
          content: item.content,
          agentId: item.agent_id ?? "meta",
          provider: item.provider,
          model: item.model,
        }));
        setPaneMessages(pane.id, mapped);
        return;
      }
    } catch {
      // Ignore and clear as fallback.
    }
    setPaneMessages(pane.id, []);
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

  return (
    <div className="h-full w-[220px] shrink-0 border-l border-border/60 bg-slate-900/50">
      <div className="border-b border-border/60 px-3 py-2 text-xs text-slate-400">{title} · 历史会话</div>
      <div className="max-h-[calc(100%-35px)] overflow-y-auto px-2 py-2">
        {sessions.length === 0 ? (
          <div className="rounded border border-dashed border-border/60 p-2 text-center text-xs text-slate-500">
            暂无会话
          </div>
        ) : (
          sessions.map((item, index) => {
            const active = item.session_id === pane.sessionId;
            const label = item.session_name || `Session ${index + 1}`;
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
                    className="w-full rounded border border-cyan-500/50 bg-slate-800 px-2 py-1 text-xs text-slate-200 outline-none"
                  />
                ) : (
                  <button
                    className={`flex w-full flex-col items-start rounded px-2 py-1 text-left text-xs transition ${
                      active ? "bg-cyan-500/15 text-cyan-200" : "text-slate-300 hover:bg-slate-800"
                    }`}
                    onClick={() => void switchSession(item.session_id)}
                    onDoubleClick={() => {
                      setEditingId(item.session_id);
                      setEditingName(label);
                    }}
                    title="双击重命名"
                  >
                    <span className="truncate w-full">{label}</span>
                    {item.session_name && item.session_name !== label && (
                      <span className="mt-0.5 truncate w-full text-[9px] text-slate-500">{item.session_name}</span>
                    )}
                    <span className="mt-0.5 truncate w-full text-[9px] text-slate-500">
                      {timeAgo(item.updated_at)}
                    </span>
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
