import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Settings } from "lucide-react";
import { useAppStore, type Avatar, type GroupChat } from "../store";
import { avatarBgClass, avatarDotColor, groupColorByIndex } from "../utils/avatar-color";
import { AvatarCreateDialog } from "./AvatarCreateDialog";
import { AvatarToolPermissionDialog } from "./AvatarToolPermissionDialog";

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function avatarColor(id: string): string {
  return avatarBgClass(id);
}

type ContextMenuState =
  | { x: number; y: number; target: "avatar"; avatarId: string }
  | { x: number; y: number; target: "machi" }
  | null;
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
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<GroupContextMenuState>(null);
  const [permissionDialog, setPermissionDialog] = useState<
    | { mode: "avatar"; avatarId: string; title: string }
    | { mode: "machi-global"; title: string }
    | null
  >(null);
  const [machiToolsEnabled, setMachiToolsEnabled] = useState<Record<string, boolean>>({});
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
          toolsEnabled: a.tools_enabled ?? {},
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
          routing: g.routing ?? "intelligent",
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

  const handleCreate = async (data: {
    name: string;
    role: string;
    systemPrompt: string;
    toolsEnabled: Record<string, boolean>;
  }) => {
    await window.agenticxDesktop.createAvatar({
      name: data.name,
      role: data.role,
      system_prompt: data.systemPrompt,
      tools_enabled: data.toolsEnabled,
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
    const avatarId = contextMenu.target === "avatar" ? contextMenu.avatarId : "";
    const target = contextMenu.target;
    setContextMenu(null);
    if (target === "avatar") {
      if (action === "pin") {
        const avatar = avatars.find((a) => a.id === avatarId);
        if (avatar) {
          await window.agenticxDesktop.updateAvatar({ id: avatarId, pinned: !avatar.pinned });
          await refreshAvatars();
        }
      } else if (action === "tools") {
        const avatar = avatars.find((a) => a.id === avatarId);
        setPermissionDialog({
          mode: "avatar",
          avatarId,
          title: `${avatar?.name ?? "分身"} · 工具权限`,
        });
      } else if (action === "delete") {
        panes.filter((item) => item.avatarId === avatarId).forEach((item) => removePane(item.id));
        if (activeAvatarId === avatarId) setActiveAvatarId(null);
        setAvatars(avatars.filter((a) => a.id !== avatarId));
        void (async () => {
          await window.agenticxDesktop.deleteAvatar(avatarId);
          await refreshAvatars();
        })();
      }
      return;
    }

    if (target === "machi" && action === "tools") {
      const policy = await window.agenticxDesktop.getToolsPolicy();
      setMachiToolsEnabled(policy?.ok ? policy.tools_enabled ?? {} : {});
      setPermissionDialog({ mode: "machi-global", title: "Machi · 工具权限（全局）" });
    }
  };

  const handleGroupDelete = async (group: GroupChat) => {
    const confirmed = window.confirm(`确定删除群聊「${group.name}」吗？此操作不可恢复。`);
    if (!confirmed) return;
    const groupPaneId = `group:${group.id}`;
    const groupPanes = panes.filter((item) => item.avatarId === groupPaneId);
    const nonGroupPanes = panes.filter((item) => item.avatarId !== groupPaneId);
    if (nonGroupPanes.length === 0 && groupPanes.length > 0) {
      addPane(null, "Machi", "");
    }
    groupPanes.forEach((item) => removePane(item.id));
    setGroups(groups.filter((g) => g.id !== group.id));
    await window.agenticxDesktop.deleteGroup(group.id);
    await refreshGroups();
  };

  const handleGroupContextAction = async (action: "view") => {
    if (!groupContextMenu) return;
    const group = groups.find((item) => item.id === groupContextMenu.groupId);
    setGroupContextMenu(null);
    if (!group) return;
    if (action === "view") setGroupEditTarget(group);
  };

  const sortedAvatars = useMemo(() => {
    return [...avatars].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [avatars]);

  return (
    <>
      <aside className="flex h-full w-full flex-col bg-surface-sidebar">
        {/* macOS traffic-light safe zone */}
        <div className="drag-region h-[38px] shrink-0" />
        {/* Meta-Agent entry */}
        <button
          className={`mx-2 mb-1 flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-all ${
            activeAvatarId === null
              ? "bg-surface-card text-text-strong"
              : "text-text-muted hover:bg-surface-card hover:text-text-strong"
          }`}
          onClick={() => void openOrFocusPane(null, "Machi")}
          onContextMenu={(e) => {
            e.preventDefault();
            setGroupContextMenu(null);
            setContextMenu({ x: e.clientX, y: e.clientY, target: "machi" });
          }}
        >
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-cyan-500 to-blue-600 text-xs font-bold text-white">
            M
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">Machi</div>
            <div className="truncate text-[10px] text-text-faint">全局调度</div>
          </div>
        </button>

        {/* Avatar list */}
        <div className="flex items-center justify-between px-4 py-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">分身 ({avatars.length})</span>
          <button
            className="rounded px-1.5 py-0.5 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
            onClick={() => setCreateOpen(true)}
          >
            + 新建
          </button>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {sortedAvatars.length === 0 && (
            <div className="px-3 py-6 text-center text-xs text-text-faint">
              暂无分身，点击上方"新建"创建
            </div>
          )}
          {sortedAvatars.map((avatar) => {
            const isActive = activeAvatarId === avatar.id;
            const hasPane = panes.some((item) => item.avatarId === avatar.id);
            return (
              <div key={avatar.id}>
                <button
                  className={`mx-2 flex w-[calc(100%-16px)] items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-all ${
                    isActive
                      ? "bg-surface-card text-text-strong"
                      : "text-text-muted hover:bg-surface-card hover:text-text-strong"
                  }`}
                  onClick={() => void openOrFocusPane(avatar.id, avatar.name)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setGroupContextMenu(null);
                    setContextMenu({ x: e.clientX, y: e.clientY, target: "avatar", avatarId: avatar.id });
                  }}
                >
                  {/* 方形圆角头像 + 右下角在线圆圈 */}
                  <div className="relative shrink-0">
                    {avatar.avatarUrl ? (
                      <img
                        src={avatar.avatarUrl}
                        alt={avatar.name}
                        className="h-8 w-8 rounded-[6px] object-cover"
                      />
                    ) : (
                      <div
                        className={`flex h-8 w-8 items-center justify-center rounded-[6px] text-xs font-bold text-white ${avatarColor(avatar.id)}`}
                      >
                        {avatarInitials(avatar.name)}
                      </div>
                    )}
                    {hasPane && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-sidebar bg-emerald-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-sm">{avatar.name}</span>
                      {avatar.pinned && <span className="text-[10px] text-amber-400">*</span>}
                    </div>
                    {avatar.role && (
                      <div className="truncate text-[10px] text-text-faint">{avatar.role}</div>
                    )}
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        {/* Group chats */}
        <div className="mt-2">
          <div className="flex items-center justify-between px-4 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-text-faint">群聊 ({groups.length})</span>
            <button
              className="rounded px-1.5 py-0.5 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
              onClick={() => setGroupCreateOpen(true)}
            >
              + 新建
            </button>
          </div>
          <div className="overflow-y-auto pb-2">
            {groups.map((group, groupIndex) => {
              const groupAvatarId = `group:${group.id}`;
              const hasPane = panes.some((item) => item.avatarId === groupAvatarId);
              const isActive = panes.some(
                (item) => item.avatarId === groupAvatarId && item.id === activePaneId
              );
              const { iconBg, dotColor } = groupColorByIndex(groupIndex);
              return (
                <button
                  key={group.id}
                  className={`mx-2 flex w-[calc(100%-16px)] items-center gap-2 rounded-[10px] px-2.5 py-1.5 text-left transition-all ${
                    isActive
                      ? "bg-surface-card text-text-strong"
                      : "text-text-muted hover:bg-surface-card hover:text-text-strong"
                  }`}
                  onClick={() => void openOrFocusGroupPane(group)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setContextMenu(null);
                    setGroupContextMenu({ x: e.clientX, y: e.clientY, groupId: group.id });
                  }}
                >
                  <div className="relative shrink-0">
                    <div
                      className="flex h-8 w-8 items-center justify-center rounded-[6px] text-[10px] font-bold text-white"
                      style={{ backgroundColor: iconBg }}
                    >
                      {group.name.slice(0, 1).toUpperCase()}
                    </div>
                    {hasPane && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-sidebar bg-emerald-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <div className="truncate text-xs">{group.name}</div>
                    </div>
                    <div className="truncate text-[10px] text-text-faint">
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
        <div className="shrink-0 px-2 py-2">
          <button
            className="flex w-full items-center gap-2.5 rounded-[10px] border border-transparent px-2.5 py-2 text-left text-[13px] font-semibold text-text-subtle transition-all hover:border-border-strong hover:bg-surface-card hover:text-text-strong"
            onClick={() => openSettings()}
          >
            <Settings className="h-4 w-4 shrink-0" aria-hidden />
            <span>设置</span>
            <span className="ml-auto text-[10px] font-normal text-text-faint">模型 · MCP · 偏好</span>
          </button>
        </div>
      </aside>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[120px] rounded-lg border border-border bg-surface-panel py-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {[
            ...(contextMenu.target === "avatar"
              ? [
                  {
                    id: "pin",
                    label: avatars.find((a) => a.id === contextMenu.avatarId)?.pinned
                      ? "取消置顶"
                      : "置顶",
                  },
                  { id: "tools", label: "工具权限" },
                  { id: "delete", label: "删除" },
                ]
              : [{ id: "tools", label: "工具权限（全局）" }]),
          ].map((item) => (
            <button
              key={item.id}
              className={`w-full px-3 py-1.5 text-left text-xs transition ${
                item.id === "delete"
                  ? "text-rose-400 hover:bg-rose-500/10"
                  : "text-text-muted hover:bg-surface-hover"
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
          className="fixed z-50 min-w-[180px] rounded-lg border border-border bg-surface-panel py-1 shadow-xl"
          style={{ left: groupContextMenu.x, top: groupContextMenu.y }}
        >
          <button
            className="w-full px-3 py-1.5 text-left text-xs text-text-muted transition hover:bg-surface-hover"
            onClick={() => void handleGroupContextAction("view")}
          >
            查看群聊
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
      {permissionDialog && (
        <AvatarToolPermissionDialog
          open={Boolean(permissionDialog)}
          mode={permissionDialog.mode}
          title={permissionDialog.title}
          initialToolsEnabled={
            permissionDialog.mode === "avatar"
              ? avatars.find((a) => a.id === permissionDialog.avatarId)?.toolsEnabled ?? {}
              : machiToolsEnabled
          }
          onClose={() => setPermissionDialog(null)}
          onSave={async (next) => {
            if (permissionDialog.mode === "avatar") {
              await window.agenticxDesktop.updateAvatar({
                id: permissionDialog.avatarId,
                tools_enabled: next,
              });
              await refreshAvatars();
              return;
            }
            const result = await window.agenticxDesktop.saveToolsPolicy({ tools_enabled: next });
            if (!result?.ok) throw new Error(result?.error || "保存全局工具权限失败");
            setMachiToolsEnabled(next);
          }}
        />
      )}

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
          onDelete={async (groupId) => {
            const group = groups.find((item) => item.id === groupId);
            if (!group) return;
            await handleGroupDelete(group);
            setGroupEditTarget(null);
          }}
          onClose={() => {
            setGroupEditTarget(null);
          }}
          onSaved={() => {
            setGroupEditTarget(null);
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
  onDelete,
  onClose,
  onSaved,
}: {
  avatars: Avatar[];
  initialGroup?: GroupChat;
  onDelete?: (groupId: string) => Promise<void>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(initialGroup?.name ?? "");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(initialGroup?.avatarIds ?? []));
  const [routing, setRouting] = useState(initialGroup?.routing ?? "intelligent");
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
        className="w-80 rounded-xl border border-border bg-surface-panel p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-3 text-sm font-semibold text-white">{initialGroup ? "编辑群聊" : "新建群聊"}</h3>

        <label className="mb-1 block text-[11px] text-text-subtle">群名称</label>
        <input
          className="mb-3 w-full rounded-md border border-border bg-surface-card px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-border-strong"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="输入群聊名称"
          autoFocus
        />

        <label className="mb-1 block text-[11px] text-text-subtle">选择分身</label>
        <div className="mb-3 max-h-36 overflow-y-auto rounded-md border border-border bg-surface-card p-1.5">
          {avatars.length === 0 && (
            <div className="py-2 text-center text-[11px] text-text-faint">暂无可用分身</div>
          )}
          {avatars.map((a) => (
            <label
              key={a.id}
              className="flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-xs text-text-muted hover:bg-surface-hover"
            >
              <input
                type="checkbox"
                checked={selectedIds.has(a.id)}
                onChange={() => toggle(a.id)}
                className="accent-cyan-500"
              />
              <span className="truncate">{a.name}</span>
              {a.role && <span className="ml-auto truncate text-[10px] text-text-faint">{a.role}</span>}
            </label>
          ))}
        </div>

        <label className="mb-1 block text-[11px] text-text-subtle">路由策略</label>
        <select
          className="mb-1 w-full rounded-md border border-border bg-surface-card px-2.5 py-1.5 text-xs text-text-primary outline-none focus:border-border-strong"
          value={routing}
          onChange={(e) => setRouting(e.target.value)}
        >
          <option value="intelligent">智能对话 · 像项目经理一样自动分配</option>
          <option value="user-directed">用户指定 · 你点谁谁回复</option>
          <option value="meta-routed">智能路由 · Machi 自动选人</option>
          <option value="round-robin">轮流回复 · 按顺序每人答一次</option>
        </select>
        <p className="mb-4 text-[10px] text-text-faint">
          {{
            "intelligent": "Machi 在后台持续看全局上下文，自动选人、追踪线程，并在成员未响应时主动督办。",
            "user-directed": "每次发消息时，手动 @某个分身，只有被点名的人回复。",
            "meta-routed": "由 Machi 根据问题内容自动判断最合适的分身来回复。",
            "round-robin": "分身按加入顺序轮流回复，每人一次，周而复始。",
          }[routing]}
        </p>

        <div className="flex items-center justify-between gap-2">
          {initialGroup ? (
            <button
              className="rounded-md px-3 py-1.5 text-xs text-rose-400 transition hover:bg-rose-500/10"
              onClick={() => {
                if (!onDelete || !initialGroup) return;
                void onDelete(initialGroup.id);
              }}
            >
              删除群聊
            </button>
          ) : (
            <div />
          )}
          <button
            className="rounded-md px-3 py-1.5 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="rounded-md bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:opacity-40"
            disabled={!name.trim() || selectedIds.size === 0 || loading}
            onClick={() => void handleSave()}
          >
            {loading ? "保存中..." : initialGroup ? "保存" : "创建"}
          </button>
        </div>
      </div>
    </div>
  );
}
