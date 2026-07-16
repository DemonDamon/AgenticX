import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MoreHorizontal, Plus, Sparkles, Star } from "lucide-react";
import { MainViewShell } from "../ds/MainViewShell";
import { useAppStore } from "../../store";
import { avatarBgClass } from "../../utils/avatar-color";
import { AvatarCreateDialog } from "../AvatarCreateDialog";
import { AvatarSettingsPanel } from "../AvatarSettingsPanel";
import { usePaneNavigation } from "../../hooks/usePaneNavigation";

function avatarInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

type CardMenuState = { avatarId: string; x: number; y: number } | null;

export function AvatarGalleryView() {
  const avatars = useAppStore((s) => s.avatars);
  const setAvatars = useAppStore((s) => s.setAvatars);
  const panes = useAppStore((s) => s.panes);
  const corePreloadAttempted = useAppStore((s) => s.corePreloadAttempted);
  const removePane = useAppStore((s) => s.removePane);
  const activeAvatarId = useAppStore((s) => s.activeAvatarId);
  const setActiveAvatarId = useAppStore((s) => s.setActiveAvatarId);

  const { openMetaOrAvatarPane, newMetaTask } = usePaneNavigation();

  const [createOpen, setCreateOpen] = useState(false);
  const [settingsAvatarId, setSettingsAvatarId] = useState<string | null>(null);
  const [cardMenu, setCardMenu] = useState<CardMenuState>(null);
  const cardMenuRef = useRef<HTMLDivElement>(null);

  const avatarsLoaded = corePreloadAttempted || avatars.length > 0;

  const sortedAvatars = useMemo(() => {
    return [...avatars].sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }, [avatars]);

  const refreshAvatars = async () => {
    window.dispatchEvent(
      new CustomEvent("agenticx:avatars:changed", { detail: { openPane: false } })
    );
  };

  useEffect(() => {
    if (!cardMenu) return;
    const dismiss = (e: MouseEvent) => {
      if (cardMenuRef.current && !cardMenuRef.current.contains(e.target as Node)) {
        setCardMenu(null);
      }
    };
    const dismissByEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCardMenu(null);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", dismissByEsc);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", dismissByEsc);
    };
  }, [cardMenu]);

  const handleCreate = async (data: {
    name: string;
    role: string;
    systemPrompt: string;
    blurb?: string;
    tags?: string[];
    toolsEnabled: Record<string, boolean>;
    skillsEnabled?: Record<string, boolean>;
    defaultProvider?: string;
    defaultModel?: string;
    workspaceDir?: string;
  }) => {
    const se = data.skillsEnabled;
    const falses =
      se && typeof se === "object"
        ? Object.fromEntries(Object.entries(se).filter(([, v]) => v === false))
        : {};
    const skillsPayload = Object.keys(falses).length > 0 ? falses : undefined;
    const dp = (data.defaultProvider || "").trim();
    const dm = (data.defaultModel || "").trim();
    const ws = (data.workspaceDir || "").trim();
    const blurb = (data.blurb || "").trim();
    const tags = (data.tags || []).filter(Boolean);
    await window.agenticxDesktop.createAvatar({
      name: data.name,
      role: data.role,
      system_prompt: data.systemPrompt,
      tools_enabled: data.toolsEnabled,
      ...(skillsPayload !== undefined ? { skills_enabled: skillsPayload } : {}),
      ...(dp ? { default_provider: dp } : {}),
      ...(dm ? { default_model: dm } : {}),
      ...(ws ? { workspace_dir: ws } : {}),
      ...(blurb ? { description: blurb } : {}),
      ...(tags.length > 0 ? { tags } : {}),
    });
    await refreshAvatars();
  };

  const handleCreateViaChat = (description: string) => {
    const draft = `帮我创建一个数字分身。\n需求描述：${description}\n\n请先跟我确认名称、角色定位和系统提示（可参考我的描述做补充/追问），确认后再创建。`;
    newMetaTask(draft);
  };

  const handlePinToggle = async (avatarId: string) => {
    setCardMenu(null);
    const avatar = avatars.find((a) => a.id === avatarId);
    if (!avatar) return;
    await window.agenticxDesktop.updateAvatar({ id: avatarId, pinned: !avatar.pinned });
    await refreshAvatars();
  };

  const handleDelete = async (avatarId: string) => {
    setCardMenu(null);
    const avatar = avatars.find((a) => a.id === avatarId);
    if (!avatar) return;
    const api = window.agenticxDesktop;
    const confirmResult =
      typeof api.confirmDialog === "function"
        ? await api.confirmDialog({
            title: "确认删除分身",
            message: `确定删除分身「${avatar.name}」吗？`,
            detail: "此操作不可恢复。",
            confirmText: "删除",
            cancelText: "取消",
            destructive: true,
          })
        : { ok: true, confirmed: window.confirm(`确定删除分身「${avatar.name}」吗？此操作不可恢复。`) };
    if (!confirmResult.confirmed) return;
    panes.filter((item) => item.avatarId === avatarId).forEach((item) => removePane(item.id));
    if (activeAvatarId === avatarId) setActiveAvatarId(null);
    setAvatars(avatars.filter((a) => a.id !== avatarId));
    await api.deleteAvatar(avatarId);
    await refreshAvatars();
  };

  const settingsAvatar = settingsAvatarId
    ? avatars.find((a) => a.id === settingsAvatarId)
    : undefined;

  return (
    <MainViewShell>
      {/* Sticky title row only; 关注分身仍靠排序置顶，不钉死 */}
      <div className="sticky top-0 z-10 -mx-6 -mt-6 mb-5 border-b border-border bg-surface-base px-6 pb-4 pt-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold text-text-strong">数字分身</h2>
            <p className="mt-1 text-sm text-text-muted">
              为你的团队召集专精分身；点击卡片可编辑设置，点「唤起」开始对话。
            </p>
          </div>
          <button
            type="button"
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-btnPrimary px-3 py-2 text-[13px] font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
            新建分身
          </button>
        </div>
      </div>

      {!avatarsLoaded ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载分身…
        </div>
      ) : sortedAvatars.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-card text-text-faint">
            <Sparkles className="h-5 w-5" />
          </div>
          <div className="text-[15px] font-semibold text-text-strong">还没有数字分身</div>
          <p className="text-sm text-text-muted">创建属于你的数字分身，处理专精任务</p>
          <button
            type="button"
            className="mt-1 flex items-center gap-1.5 rounded-lg bg-btnPrimary px-3 py-2 text-[13px] font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-4 w-4" />
            新建分身
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {sortedAvatars.map((avatar) => {
            const hasPane = panes.some((p) => p.avatarId === avatar.id);
            return (
              <div
                key={avatar.id}
                role="button"
                tabIndex={0}
                className="group relative flex cursor-pointer flex-col rounded-xl border border-border bg-surface-card p-4 transition-all hover:border-text-faint hover:bg-surface-card-strong"
                onClick={() => setSettingsAvatarId(avatar.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setSettingsAvatarId(avatar.id);
                  }
                }}
              >
                <div className="flex items-start gap-3">
                  <div className="relative shrink-0">
                    {avatar.avatarUrl ? (
                      <img
                        src={avatar.avatarUrl}
                        alt={avatar.name}
                        className="h-14 w-14 rounded-2xl object-cover"
                      />
                    ) : (
                      <div
                        className={`flex h-14 w-14 items-center justify-center rounded-2xl text-base font-bold text-white ${avatarBgClass(avatar.color)}`}
                      >
                        {avatarInitials(avatar.name)}
                      </div>
                    )}
                    {hasPane && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-card bg-emerald-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1 pt-0.5">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-[15px] font-semibold text-text-strong">
                        {avatar.name}
                      </span>
                      {avatar.pinned && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                    </div>
                    {avatar.role && (
                      <p className="mt-0.5 truncate text-xs text-text-muted">{avatar.role}</p>
                    )}
                  </div>
                </div>
                {avatar.description ? (
                  <p className="mt-3 line-clamp-2 text-xs leading-relaxed text-text-muted">
                    {avatar.description}
                  </p>
                ) : null}
                {avatar.tags && avatar.tags.length > 0 ? (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {avatar.tags.map((tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-surface-hover px-2 py-0.5 text-[11px] text-text-subtle"
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                ) : null}
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3">
                  <button
                    type="button"
                    className="flex-1 rounded-md border border-border bg-surface-panel px-3 py-2 text-xs font-medium text-text-strong transition hover:border-[rgb(var(--theme-color-rgb,59,130,246))] hover:text-[rgb(var(--theme-color-rgb,59,130,246))] hover:ring-1 hover:ring-[rgba(var(--theme-color-rgb,59,130,246),0.25)]"
                    onClick={(e) => {
                      e.stopPropagation();
                      openMetaOrAvatarPane(avatar.id, avatar.name);
                    }}
                  >
                    立即对话
                  </button>
                  <button
                    type="button"
                    className="shrink-0 rounded-md border border-border p-2 text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
                    aria-label="更多操作"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                      setCardMenu({ avatarId: avatar.id, x: rect.right - 132, y: rect.bottom + 4 });
                    }}
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </button>
                </div>
              </div>
            );
          })}
          <button
            type="button"
            className="flex min-h-[168px] flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-border text-text-faint transition hover:border-text-faint hover:text-text-muted"
            onClick={() => setCreateOpen(true)}
          >
            <Plus className="h-5 w-5" />
            <span className="text-[13px] font-medium">创建分身</span>
          </button>
        </div>
      )}

      {cardMenu && (
        <div
          ref={cardMenuRef}
          className="fixed z-[200] w-[132px] rounded-md border border-border bg-surface-base py-1 shadow-2xl"
          style={{ left: cardMenu.x, top: cardMenu.y }}
        >
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-[13px] text-text-muted transition hover:bg-surface-hover"
            onClick={() => {
              const id = cardMenu.avatarId;
              setCardMenu(null);
              setSettingsAvatarId(id);
            }}
          >
            设置
          </button>
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-[13px] text-text-muted transition hover:bg-surface-hover"
            onClick={() => void handlePinToggle(cardMenu.avatarId)}
          >
            {avatars.find((a) => a.id === cardMenu.avatarId)?.pinned ? "取消关注" : "关注"}
          </button>
          {avatars.find((a) => a.id === cardMenu.avatarId)?.workspaceDir ? (
            <button
              type="button"
              className="w-full px-3 py-1.5 text-left text-[13px] text-text-muted transition hover:bg-surface-hover"
              onClick={() => {
                const dir = avatars.find((a) => a.id === cardMenu.avatarId)?.workspaceDir;
                setCardMenu(null);
                if (dir) void window.agenticxDesktop.shellOpenPath(dir);
              }}
            >
              打开文件夹
            </button>
          ) : null}
          <button
            type="button"
            className="w-full px-3 py-1.5 text-left text-[13px] text-rose-400 transition hover:bg-rose-500/10"
            onClick={() => void handleDelete(cardMenu.avatarId)}
          >
            删除
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
        onCreateViaChat={handleCreateViaChat}
      />

      {settingsAvatar && (
        <AvatarSettingsPanel
          mode="avatar"
          avatar={settingsAvatar}
          onClose={() => setSettingsAvatarId(null)}
          onSaved={() => void refreshAvatars()}
        />
      )}
    </MainViewShell>
  );
}
