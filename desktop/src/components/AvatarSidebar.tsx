import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore, type Avatar, type SessionItem, type GroupChat } from "../store";
import { AvatarCreateDialog } from "./AvatarCreateDialog";

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const PALETTE = [
  "bg-cyan-600", "bg-violet-600", "bg-rose-600", "bg-amber-600",
  "bg-emerald-600", "bg-fuchsia-600", "bg-sky-600", "bg-orange-600",
];

function avatarColor(id: string): string {
  let hash = 0;
  for (const ch of id) hash = ((hash << 5) - hash + ch.charCodeAt(0)) | 0;
  return PALETTE[Math.abs(hash) % PALETTE.length];
}

type ContextMenuState = { x: number; y: number; avatarId: string } | null;

export function AvatarSidebar() {
  const avatars = useAppStore((s) => s.avatars);
  const activeAvatarId = useAppStore((s) => s.activeAvatarId);
  const setAvatars = useAppStore((s) => s.setAvatars);
  const setActiveAvatarId = useAppStore((s) => s.setActiveAvatarId);
  const sessionId = useAppStore((s) => s.sessionId);
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const setSessionId = useAppStore((s) => s.setSessionId);
  const clearMessages = useAppStore((s) => s.clearMessages);
  const avatarSessions = useAppStore((s) => s.avatarSessions);
  const setAvatarSessions = useAppStore((s) => s.setAvatarSessions);
  const groups = useAppStore((s) => s.groups);
  const setGroups = useAppStore((s) => s.setGroups);
  const [createOpen, setCreateOpen] = useState(false);
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const refreshSessions = useCallback(async (avatarId: string | null) => {
    if (!avatarId) {
      setAvatarSessions([]);
      return;
    }
    try {
      const result = await window.agenticxDesktop.listSessions(avatarId);
      if (result.ok && Array.isArray(result.sessions)) {
        setAvatarSessions(
          result.sessions.map((s) => ({
            sessionId: s.session_id,
            avatarId: s.avatar_id,
            sessionName: s.session_name,
            updatedAt: s.updated_at,
          }))
        );
      }
    } catch {
      setAvatarSessions([]);
    }
  }, [setAvatarSessions]);

  useEffect(() => {
    void refreshSessions(activeAvatarId);
  }, [activeAvatarId, refreshSessions]);

  const handleCreateSession = async (avatarId: string) => {
    const result = await window.agenticxDesktop.createSession({ avatar_id: avatarId });
    if (result.ok && result.session_id) {
      await refreshSessions(avatarId);
      clearMessages();
      setSessionId(result.session_id);
    }
  };

  const handleSwitchSession = async (sid: string, avatarId: string) => {
    clearMessages();
    try {
      const resp = await fetch(`${apiBase}/api/session?avatar_id=${encodeURIComponent(avatarId)}&session_id=${encodeURIComponent(sid)}`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      const data = await resp.json();
      setSessionId(data.session_id);
    } catch {
      // keep previous session on failure
    }
  };

  const refreshAvatars = useCallback(async () => {
    const result = await window.agenticxDesktop.listAvatars();
    if (result.ok && Array.isArray(result.avatars)) {
      setAvatars(
        result.avatars.map((a) => ({
          id: a.id,
          name: a.name,
          role: a.role ?? "",
          avatarUrl: a.avatar_url ?? "",
          pinned: Boolean(a.pinned),
          createdBy: a.created_by ?? "manual",
        }))
      );
    }
  }, [setAvatars]);

  const refreshGroups = useCallback(async () => {
    const result = await window.agenticxDesktop.listGroups();
    if (result.ok && Array.isArray(result.groups)) {
      setGroups(
        result.groups.map((g) => ({
          id: g.id,
          name: g.name,
          avatarIds: g.avatar_ids ?? [],
          routing: g.routing ?? "user-directed",
        }))
      );
    }
  }, [setGroups]);

  useEffect(() => {
    void refreshAvatars();
    void refreshGroups();
  }, [refreshAvatars, refreshGroups]);

  useEffect(() => {
    if (!contextMenu) return;
    const dismiss = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    window.addEventListener("mousedown", dismiss);
    return () => window.removeEventListener("mousedown", dismiss);
  }, [contextMenu]);

  const handleCreate = async (data: { name: string; role: string; systemPrompt: string }) => {
    await window.agenticxDesktop.createAvatar({
      name: data.name,
      role: data.role,
      system_prompt: data.systemPrompt,
    });
    await refreshAvatars();
  };

  const switchToAvatar = async (avatarId: string | null) => {
    if (avatarId === activeAvatarId) return;
    clearMessages();
    setActiveAvatarId(avatarId);
    const params = new URLSearchParams();
    if (avatarId) params.set("avatar_id", avatarId);
    try {
      const resp = await fetch(`${apiBase}/api/session?${params.toString()}`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      const data = await resp.json();
      setSessionId(data.session_id);
    } catch {
      // keep previous session on failure
    }
  };

  const handleContextAction = async (action: string) => {
    if (!contextMenu) return;
    const id = contextMenu.avatarId;
    setContextMenu(null);
    if (action === "pin") {
      const avatar = avatars.find((a) => a.id === id);
      if (avatar) {
        await window.agenticxDesktop.updateAvatar({ id, pinned: !avatar.pinned });
        await refreshAvatars();
      }
    } else if (action === "delete") {
      await window.agenticxDesktop.deleteAvatar(id);
      if (activeAvatarId === id) {
        await switchToAvatar(null);
      }
      await refreshAvatars();
    }
  };

  const sortedAvatars = useMemo(() => {
    return [...avatars].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [avatars]);

  return (
    <>
      <aside className="flex h-full w-[220px] min-w-[200px] max-w-[260px] flex-col border-r border-border/60 bg-slate-900/70">
        {/* Meta-Agent entry */}
        <button
          className={`flex items-center gap-2.5 border-b border-border/40 px-3 py-2.5 text-left transition ${
            activeAvatarId === null
              ? "bg-cyan-500/10 text-cyan-400"
              : "text-slate-300 hover:bg-slate-800"
          }`}
          onClick={() => void switchToAvatar(null)}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-xs font-bold text-white">
            M
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">Meta-Agent</div>
            <div className="truncate text-[10px] text-slate-500">全局调度</div>
          </div>
        </button>

        {/* Avatar list */}
        <div className="flex items-center justify-between border-b border-border/40 px-3 py-1.5">
          <span className="text-[11px] font-medium text-slate-500">分身 ({avatars.length})</span>
          <button
            className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:bg-slate-700 hover:text-white"
            onClick={() => setCreateOpen(true)}
          >
            + 新建
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {sortedAvatars.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-slate-600">
              暂无分身，点击上方"新建"创建
            </div>
          )}
          {sortedAvatars.map((avatar) => {
            const isActive = activeAvatarId === avatar.id;
            const sessions = isActive
              ? avatarSessions.filter((s) => s.avatarId === avatar.id)
              : [];
            return (
              <div key={avatar.id}>
                <button
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                    isActive
                      ? "bg-cyan-500/10 text-cyan-400"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                  onClick={() => void switchToAvatar(avatar.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu({ x: e.clientX, y: e.clientY, avatarId: avatar.id });
                  }}
                >
                  {avatar.avatarUrl ? (
                    <img
                      src={avatar.avatarUrl}
                      alt={avatar.name}
                      className="h-8 w-8 shrink-0 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${avatarColor(avatar.id)}`}
                    >
                      {avatarInitials(avatar.name)}
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-sm">{avatar.name}</span>
                      {avatar.pinned && <span className="text-[10px] text-amber-400">*</span>}
                    </div>
                    {avatar.role && (
                      <div className="truncate text-[10px] text-slate-500">{avatar.role}</div>
                    )}
                  </div>
                </button>
                {isActive && (
                  <div className="border-l-2 border-cyan-500/30 ml-6 py-0.5">
                    {sessions.map((sess, idx) => (
                      <button
                        key={sess.sessionId}
                        className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] transition ${
                          sessionId === sess.sessionId
                            ? "text-cyan-300 bg-cyan-500/5"
                            : "text-slate-400 hover:text-slate-200 hover:bg-slate-800/50"
                        }`}
                        onClick={() => void handleSwitchSession(sess.sessionId, avatar.id)}
                      >
                        <span className="truncate">{sess.sessionName || `Session ${idx + 1}`}</span>
                      </button>
                    ))}
                    <button
                      className="flex w-full items-center gap-1.5 px-3 py-1 text-left text-[11px] text-slate-500 transition hover:text-cyan-400 hover:bg-slate-800/50"
                      onClick={() => void handleCreateSession(avatar.id)}
                    >
                      + 新会话
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Group chats */}
        <div className="border-t border-border/40">
          <div className="flex items-center justify-between px-3 py-1.5">
            <span className="text-[11px] font-medium text-slate-500">群聊 ({groups.length})</span>
            <button
              className="rounded px-1.5 py-0.5 text-[11px] text-slate-400 transition hover:bg-slate-700 hover:text-white"
              onClick={() => setGroupCreateOpen(true)}
            >
              + 新建
            </button>
          </div>
          <div className="overflow-y-auto pb-2">
            {groups.map((group) => (
              <button
                key={group.id}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-slate-300 transition hover:bg-slate-800"
                onClick={() => {/* TODO: switch to group session */}}
              >
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600/60 text-[10px] font-bold text-white">
                  G
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{group.name}</div>
                  <div className="truncate text-[10px] text-slate-500">{group.avatarIds.length} avatars</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[120px] rounded-lg border border-border bg-panel py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {[
            { id: "pin", label: avatars.find((a) => a.id === contextMenu.avatarId)?.pinned ? "取消置顶" : "置顶" },
            { id: "delete", label: "删除" },
          ].map((item) => (
            <button
              key={item.id}
              className={`w-full px-3 py-1.5 text-left text-xs transition ${
                item.id === "delete"
                  ? "text-rose-400 hover:bg-rose-500/10"
                  : "text-slate-300 hover:bg-slate-700"
              }`}
              onClick={() => void handleContextAction(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      <AvatarCreateDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
          void refreshAvatars();
        }}
        onCreate={handleCreate}
      />

      {groupCreateOpen && (
        <GroupCreateInline
          avatars={avatars}
          onClose={() => setGroupCreateOpen(false)}
          onCreated={() => {
            setGroupCreateOpen(false);
            void refreshGroups();
          }}
        />
      )}
    </>
  );
}

function GroupCreateInline({
  avatars,
  onClose,
  onCreated,
}: {
  avatars: Avatar[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [routing, setRouting] = useState("user-directed");
  const [loading, setLoading] = useState(false);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!name.trim() || selectedIds.size === 0) return;
    setLoading(true);
    try {
      const result = await window.agenticxDesktop.createGroup({
        name: name.trim(),
        avatar_ids: Array.from(selectedIds),
        routing,
      });
      if (result.ok) onCreated();
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-80 rounded-xl border border-border bg-slate-900 p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold text-white">新建群聊</h3>

        <label className="mb-1 block text-[11px] text-slate-400">群名称</label>
        <input
          className="mb-3 w-full rounded-md border border-border bg-slate-800 px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入群聊名称"
          autoFocus
        />

        <label className="mb-1 block text-[11px] text-slate-400">选择分身</label>
        <div className="mb-3 max-h-36 overflow-y-auto rounded-md border border-border bg-slate-800 p-1.5">
          {avatars.length === 0 && (
            <div className="py-2 text-center text-[11px] text-slate-500">暂无可用分身</div>
          )}
          {avatars.map((a) => (
            <label
              key={a.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-slate-300 hover:bg-slate-700"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(a.id)}
                onChange={() => toggle(a.id)}
                className="accent-cyan-500"
              />
              <span className="truncate">{a.name}</span>
              {a.role && <span className="ml-auto truncate text-[10px] text-slate-500">{a.role}</span>}
            </label>
          ))}
        </div>

        <label className="mb-1 block text-[11px] text-slate-400">路由策略</label>
        <select
          className="mb-4 w-full rounded-md border border-border bg-slate-800 px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
          value={routing}
          onChange={(e) => setRouting(e.target.value)}
        >
          <option value="user-directed">User Directed</option>
          <option value="meta-routed">Meta Routed</option>
          <option value="round-robin">Round Robin</option>
        </select>

        <div className="flex justify-end gap-2">
          <button
            className="rounded-md px-3 py-1.5 text-xs text-slate-400 transition hover:bg-slate-700 hover:text-white"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:opacity-40"
            disabled={!name.trim() || selectedIds.size === 0 || loading}
            onClick={() => void handleCreate()}
          >
            {loading ? "创建中..." : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
