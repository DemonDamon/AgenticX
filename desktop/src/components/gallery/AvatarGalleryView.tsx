import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MoreHorizontal, Plus, Star } from "lucide-react";
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

  const { openMetaOrAvatarPane } = usePaneNavigation();

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
    await window.agenticxDesktop.createAvatar({
      name: data.name,
      role: data.role,
      system_prompt: data.systemPrompt,
      tools_enabled: data.toolsEnabled,
      ...(skillsPayload !== undefined ? { skills_enabled: skillsPayload } : {}),
      ...(dp ? { default_provider: dp } : {}),
      ...(dm ? { default_model: dm } : {}),
      ...(ws ? { workspace_dir: ws } : {}),
    });
    await refreshAvatars();
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
      <div className="mb-5 flex items-start justify-between gap-4">
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

      {!avatarsLoaded ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-text-faint">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在加载分身…
        </div>
      ) : sortedAvatars.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-16 text-center">
          <div className="text-sm text-text-muted">还没有数字分身</div>
          <button
            type="button"
            className="flex items-center gap-1.5 rounded-lg bg-btnPrimary px-3 py-2 text-[13px] font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
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
                        className="h-11 w-11 rounded-[10px] object-cover"
                      />
                    ) : (
                      <div
                        className={`flex h-11 w-11 items-center justify-center rounded-[10px] text-sm font-bold text-white ${avatarBgClass(avatar.color)}`}
                      >
                        {avatarInitials(avatar.name)}
                      </div>
                    )}
                    {hasPane && (
                      <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-surface-card bg-emerald-500" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1">
                      <span className="truncate text-[15px] font-semibold text-text-strong">
                        {avatar.name}
                      </span>
                      {avatar.pinned && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
                    </div>
                    {avatar.role && (
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-text-muted">
                        {avatar.role}
                      </p>
                    )}
                  </div>
                  <button
                    type="button"
                    className="shrink-0 rounded-md p-1 text-text-faint transition hover:bg-surface-hover hover:text-text-strong"
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
                <div className="mt-3 flex justify-end">
                  <button
                    type="button"
                    className="rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover"
                    onClick={(e) => {
                      e.stopPropagation();
                      openMetaOrAvatarPane(avatar.id, avatar.name);
                    }}
                  >
                    唤起
                  </button>
                </div>
              </div>
            );
          })}
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
