import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppStore, type Avatar, type GroupChat } from "../store";
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
type GroupContextMenuState = { x: number; y: number; groupId: string } | null;

export function AvatarSidebar() {
  const avatars = useAppStore((s) => s.avatars);
  const activeAvatarId = useAppStore((s) => s.activeAvatarId);
  const setAvatars = useAppStore((s) => s.setAvatars);
  const setActiveAvatarId = useAppStore((s) => s.setActiveAvatarId);
  const panes = useAppStore((s) => s.panes);
  const activePaneId = useAppStore((s) => s.activePaneId);
  const addPane = useAppStore((s) => s.addPane);
  const removePane = useAppStore((s) => s.removePane);
  const setActivePaneId = useAppStore((s) => s.setActivePaneId);
  const setPaneSessionId = useAppStore((s) => s.setPaneSessionId);
  const groups = useAppStore((s) => s.groups);
  const setGroups = useAppStore((s) => s.setGroups);
  const openSettings = useAppStore((s) => s.openSettings);
  const [createOpen, setCreateOpen] = useState(false);
  const [groupCreateOpen, setGroupCreateOpen] = useState(false);
  const [groupEditTarget, setGroupEditTarget] = useState<GroupChat | null>(null);
  const [groupEditReadOnly, setGroupEditReadOnly] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<GroupContextMenuState>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const groupMenuRef = useRef<HTMLDivElement>(null);
  const openingRef = useRef(false);

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
    const dismissByEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setContextMenu(null);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", dismissByEsc);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", dismissByEsc);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!groupContextMenu) return;
    const dismiss = (e: MouseEvent) => {
      if (groupMenuRef.current && !groupMenuRef.current.contains(e.target as Node)) {
        setGroupContextMenu(null);
      }
    };
    const dismissByEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setGroupContextMenu(null);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", dismissByEsc);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", dismissByEsc);
    };
  }, [groupContextMenu]);

  const handleCreate = async (data: { name: string; role: string; systemPrompt: string }) => {
    await window.agenticxDesktop.createAvatar({
      name: data.name,
      role: data.role,
      system_prompt: data.systemPrompt,
    });
    await refreshAvatars();
  };

  const openOrFocusPane = (avatarId: string | null, avatarName: string) => {
    const existing = panes.find((item) => item.avatarId === avatarId);
    if (existing) {
      setActivePaneId(existing.id);
      setActiveAvatarId(avatarId);
      return;
    }

    if (openingRef.current) return;
    openingRef.current = true;

    const paneId = addPane(avatarId, avatarName, "");
    setActivePaneId(paneId);
    setActiveAvatarId(avatarId);

    void (async () => {
      try {
        const created = await window.agenticxDesktop.createSession({
          avatar_id: avatarId ?? undefined,
        });
        if (created.ok && created.session_id) {
          setPaneSessionId(paneId, created.session_id);
        }
      } finally {
        openingRef.current = false;
      }
    })();
  };

  const openOrFocusGroupPane = (group: { id: string; name: string }) => {
    const groupAvatarId = `group:${group.id}`;
    const existing = panes.find((item) => item.avatarId === groupAvatarId);
    if (existing) {
      setActivePaneId(existing.id);
      setActiveAvatarId(null);
      return;
    }

    if (openingRef.current) return;
    openingRef.current = true;

    const paneId = addPane(groupAvatarId, `群聊 · ${group.name}`, "");
    setActivePaneId(paneId);
    setActiveAvatarId(null);

    void (async () => {
      try {
        const created = await window.agenticxDesktop.createSession({
          avatar_id: groupAvatarId,
          name: group.name,
        });
        if (created.ok && created.session_id) {
          setPaneSessionId(paneId, created.session_id);
        }
      } finally {
        openingRef.current = false;
      }
    })();
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
      panes.filter((item) => item.avatarId === id).forEach((item) => removePane(item.id));
      if (activeAvatarId === id) setActiveAvatarId(null);
      setAvatars(avatars.filter((a) => a.id !== id));
      void (async () => {
        await window.agenticxDesktop.deleteAvatar(id);
        await refreshAvatars();
      })();
    }
  };

  const handleGroupContextAction = async (action: "view" | "edit" | "delete") => {
    if (!groupContextMenu) return;
    const group = groups.find((item) => item.id === groupContextMenu.groupId);
    setGroupContextMenu(null);
    if (!group) return;
    if (action === "delete") {
      const groupPaneId = `group:${group.id}`;
      panes.filter((item) => item.avatarId === groupPaneId).forEach((item) => removePane(item.id));
      setGroups(groups.filter((g) => g.id !== group.id));
      void (async () => {
        await window.agenticxDesktop.deleteGroup(group.id);
        await refreshGroups();
      })();
      return;
    }
    setGroupEditReadOnly(action === "view");
    setGroupEditTarget(group);
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
        {/* macOS traffic-light safe zone */}
        <div className="drag-region h-[38px] shrink-0" />
        {/* Meta-Agent entry */}
        <button
          className={`flex items-center gap-2.5 border-b border-border/40 px-3 py-2.5 text-left transition ${
            activeAvatarId === null
              ? "bg-cyan-500/10 text-cyan-400"
              : "text-slate-300 hover:bg-slate-800"
          }`}
          onClick={() => void openOrFocusPane(null, "Meta-Agent")}
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
            const hasPane = panes.some((item) => item.avatarId === avatar.id);
            return (
              <div key={avatar.id}>
                <button
                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-left transition ${
                    isActive
                      ? "bg-cyan-500/10 text-cyan-400"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                  onClick={() => void openOrFocusPane(avatar.id, avatar.name)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setGroupContextMenu(null);
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
                      {hasPane && <span className="h-1.5 w-1.5 rounded-full bg-cyan-400" />}
                      {avatar.pinned && <span className="text-[10px] text-amber-400">*</span>}
                    </div>
                    {avatar.role && (
                      <div className="truncate text-[10px] text-slate-500">{avatar.role}</div>
                    )}
                  </div>
                </button>
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
            {groups.map((group) => {
              const groupAvatarId = `group:${group.id}`;
              const hasPane = panes.some((item) => item.avatarId === groupAvatarId);
              const isActive = panes.some(
                (item) => item.avatarId === groupAvatarId && item.id === activePaneId
              );
              return (
                <button
                  key={group.id}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left transition ${
                    isActive
                      ? "bg-violet-500/10 text-violet-300"
                      : "text-slate-300 hover:bg-slate-800"
                  }`}
                  onClick={() => void openOrFocusGroupPane(group)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu(null);
                    setGroupContextMenu({ x: e.clientX, y: e.clientY, groupId: group.id });
                  }}
                >
                  <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-violet-600/60 text-[10px] font-bold text-white">
                    G
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <div className="truncate text-xs">{group.name}</div>
                      {hasPane && <span className="h-1.5 w-1.5 rounded-full bg-violet-300" />}
                    </div>
                    <div className="truncate text-[10px] text-slate-500">
                      {group.avatarIds.length} avatars ·{" "}
                      {group.avatarIds
                        .map((id) => avatars.find((a) => a.id === id)?.name || id.slice(0, 4))
                        .join(", ")}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Settings entry */}
        <div className="shrink-0 border-t border-border/40 px-3 py-2">
          <button
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-slate-400 transition hover:bg-slate-700 hover:text-white"
            onClick={() => openSettings()}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.431.992a7.723 7.723 0 0 1 0 .255c-.007.378.138.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
            </svg>
            <span>设置</span>
            <span className="ml-auto text-[10px] text-slate-600">模型 · MCP · 偏好</span>
          </button>
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

      {groupContextMenu && (
        <div
          ref={groupMenuRef}
          className="fixed z-50 min-w-[180px] rounded-lg border border-border bg-panel py-1 shadow-xl"
          style={{ left: groupContextMenu.x, top: groupContextMenu.y }}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-slate-300 transition hover:bg-slate-700"
            onClick={() => void handleGroupContextAction("view")}
          >
            查看成员
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-slate-300 transition hover:bg-slate-700"
            onClick={() => void handleGroupContextAction("edit")}
          >
            编辑群聊
          </button>
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-rose-400 transition hover:bg-rose-500/10"
            onClick={() => void handleGroupContextAction("delete")}
          >
            删除群聊
          </button>
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
        <GroupEditorInline
          avatars={avatars}
          onClose={() => setGroupCreateOpen(false)}
          onSaved={() => {
            setGroupCreateOpen(false);
            void refreshGroups();
          }}
        />
      )}

      {groupEditTarget && (
        <GroupEditorInline
          avatars={avatars}
          initialGroup={groupEditTarget}
          readOnly={groupEditReadOnly}
          onClose={() => {
            setGroupEditTarget(null);
            setGroupEditReadOnly(false);
          }}
          onSaved={() => {
            setGroupEditTarget(null);
            setGroupEditReadOnly(false);
            void refreshGroups();
          }}
        />
      )}
    </>
  );
}

function GroupEditorInline({
  avatars,
  initialGroup,
  readOnly,
  onClose,
  onSaved,
}: {
  avatars: Avatar[];
  initialGroup?: GroupChat;
  readOnly?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialGroup?.name ?? "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialGroup?.avatarIds ?? []));
  const [routing, setRouting] = useState(initialGroup?.routing ?? "user-directed");
  const [loading, setLoading] = useState(false);

  const toggle = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    if (!name.trim() || selectedIds.size === 0) return;
    setLoading(true);
    try {
      if (initialGroup) {
        const result = await window.agenticxDesktop.updateGroup({
          id: initialGroup.id,
          name: name.trim(),
          avatar_ids: Array.from(selectedIds),
          routing,
        });
        if (result.ok) onSaved();
      } else {
        const result = await window.agenticxDesktop.createGroup({
          name: name.trim(),
          avatar_ids: Array.from(selectedIds),
          routing,
        });
        if (result.ok) onSaved();
      }
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
        <h3 className="mb-3 text-sm font-semibold text-white">{initialGroup ? "编辑群聊" : "新建群聊"}</h3>

        <label className="mb-1 block text-[11px] text-slate-400">群名称</label>
        <input
          className="mb-3 w-full rounded-md border border-border bg-slate-800 px-2.5 py-1.5 text-xs text-white outline-none focus:border-cyan-500"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={Boolean(readOnly)}
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
                disabled={Boolean(readOnly)}
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
          disabled={Boolean(readOnly)}
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
          {!readOnly && (
            <button
              className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:opacity-40"
              disabled={!name.trim() || selectedIds.size === 0 || loading}
              onClick={() => void handleSave()}
            >
              {loading ? "保存中..." : initialGroup ? "保存" : "创建"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
