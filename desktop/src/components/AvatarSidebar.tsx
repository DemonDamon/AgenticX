import { useCallback, useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { AlarmClock, MessageSquarePlus, UserRound, Waypoints } from "lucide-react";
import { useAppStore, type MainView } from "../store";
import { APP_DISPLAY_NAME, APP_VERSION, META_AGENT_DISPLAY_NAME } from "../constants/branding";
import { DEFAULT_META_AVATAR_URL } from "../constants/meta-avatar";
import { usePaneNavigation } from "../hooks/usePaneNavigation";
import { AvatarSettingsPanel } from "./AvatarSettingsPanel";
import { TopbarLeftControls } from "./TopbarLeftControls";

type Props = {
  onToggleSidebar: () => void;
};

type MachiContextMenuState = { x: number; y: number } | null;

const SIDEBAR_CONTEXT_MENU_CLASS =
  "fixed z-[200] w-[120px] rounded-md border border-border bg-surface-base py-1 shadow-2xl";
const SIDEBAR_CONTEXT_MENU_ITEM_CLASS =
  "w-full whitespace-nowrap px-3 py-1.5 text-left text-[13px] transition";

/** Compact nav row: theme-tint selected bg, no border. */
const NAV_ITEM_BASE =
  "flex w-full items-center gap-2 rounded-lg px-2.5 py-[7px] text-left text-[13px] leading-none transition-colors";
const NAV_ITEM_IDLE = "text-text-muted hover:bg-surface-hover hover:text-text-strong";
const NAV_ITEM_ACTIVE =
  "bg-[rgba(var(--theme-color-rgb,59,130,246),0.14)] font-medium text-[rgb(var(--theme-color-rgb,59,130,246))]";

type NavEntry =
  | { kind: "action"; id: "new-task"; label: string; icon: LucideIcon }
  | { kind: "view"; id: MainView; label: string; icon: LucideIcon };

const NAV_ENTRIES: NavEntry[] = [
  { kind: "action", id: "new-task", label: "新建任务", icon: MessageSquarePlus },
  { kind: "view", id: "avatars", label: "数字分身", icon: UserRound },
  { kind: "view", id: "groups", label: "项目群聊", icon: Waypoints },
  { kind: "view", id: "automation", label: "定时任务", icon: AlarmClock },
];

export function AvatarSidebar({ onToggleSidebar }: Props) {
  const setAvatars = useAppStore((s) => s.setAvatars);
  const setGroups = useAppStore((s) => s.setGroups);
  const metaAvatarUrl = useAppStore((s) => s.metaAvatarUrl);
  const mainView = useAppStore((s) => s.mainView);
  const setMainView = useAppStore((s) => s.setMainView);
  const activePaneId = useAppStore((s) => s.activePaneId);
  const panes = useAppStore((s) => s.panes);

  const { openMetaOrAvatarPane, newMetaTask } = usePaneNavigation();

  const [machiContextMenu, setMachiContextMenu] = useState<MachiContextMenuState>(null);
  const [machiSettingsOpen, setMachiSettingsOpen] = useState(false);
  const machiMenuRef = useRef<HTMLDivElement>(null);

  const metaPaneActive =
    mainView === "chat" &&
    panes.some((p) => p.id === activePaneId && p.avatarId === null);

  const refreshAvatars = useCallback(async (): Promise<boolean> => {
    try {
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
            systemPrompt: a.system_prompt ?? "",
            toolsEnabled: a.tools_enabled ?? {},
            skillsEnabled:
              a.skills_enabled && typeof a.skills_enabled === "object"
                ? { ...a.skills_enabled }
                : undefined,
            brainsEnabled:
              a.brains_enabled === "*"
                ? "*"
                : Array.isArray(a.brains_enabled)
                  ? a.brains_enabled.map(String)
                  : undefined,
            defaultProvider: a.default_provider ?? "",
            defaultModel: a.default_model ?? "",
            color: typeof a.color === "string" ? a.color : "",
            workspaceDir: a.workspace_dir ?? "",
            description: a.description ?? "",
            tags: Array.isArray(a.tags) ? a.tags.map(String) : [],
          }))
        );
        return true;
      }
      return false;
    } catch (err) {
      console.error("[AvatarSidebar] refreshAvatars error:", err);
      return false;
    }
  }, [setAvatars]);

  const refreshGroups = useCallback(async (): Promise<boolean> => {
    try {
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
        return true;
      }
      return false;
    } catch (err) {
      console.error("[AvatarSidebar] refreshGroups error:", err);
      return false;
    }
  }, [setGroups]);

  // Keep the store's avatar / group lists fresh so the gallery & projects
  // views always render current data. App.tsx already provides a startup
  // fallback; this refresh (with a short retry loop during cold start) is the
  // primary post-splash path.
  useEffect(() => {
    let cancelled = false;
    const preloaded = useAppStore.getState().corePreloadAttempted;
    const delays = [2000, 4000, 8000, 16000, 30000];
    const runWithRetries = async (
      label: "avatars" | "groups",
      fn: () => Promise<boolean>
    ) => {
      for (let i = 0; i <= delays.length; i++) {
        if (cancelled) return;
        const ok = await fn();
        if (ok || cancelled) return;
        const delay = delays[i] ?? delays[delays.length - 1];
        await new Promise((r) => setTimeout(r, delay));
        if (cancelled) return;
        console.warn(`[AvatarSidebar] ${label} refresh failed, retrying...`);
      }
    };

    if (preloaded) {
      void refreshAvatars();
      void refreshGroups();
    } else {
      void runWithRetries("avatars", refreshAvatars);
      void runWithRetries("groups", refreshGroups);
    }
    return () => {
      cancelled = true;
    };
  }, [refreshAvatars, refreshGroups]);

  // When an avatar is created / changed elsewhere, refresh the list and
  // optionally open its pane (detail.openPane !== false).
  useEffect(() => {
    const onAvatarsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ avatarId?: string; name?: string; openPane?: boolean }>)
        .detail;
      const avatarId = String(detail?.avatarId ?? "").trim();
      const avatarName = String(detail?.name ?? "").trim();
      const shouldOpen = detail?.openPane !== false;
      void (async () => {
        await refreshAvatars();
        if (shouldOpen && avatarId) {
          openMetaOrAvatarPane(avatarId, avatarName || avatarId);
        }
      })();
    };
    window.addEventListener("agenticx:avatars:changed", onAvatarsChanged);
    return () => window.removeEventListener("agenticx:avatars:changed", onAvatarsChanged);
  }, [refreshAvatars, openMetaOrAvatarPane]);

  // When groups change elsewhere, refresh the store list.
  useEffect(() => {
    const onGroupsChanged = () => {
      void refreshGroups();
    };
    window.addEventListener("agenticx:groups:changed", onGroupsChanged);
    return () => window.removeEventListener("agenticx:groups:changed", onGroupsChanged);
  }, [refreshGroups]);

  useEffect(() => {
    if (!machiContextMenu) return;
    const dismiss = (e: MouseEvent) => {
      if (machiMenuRef.current && !machiMenuRef.current.contains(e.target as Node)) {
        setMachiContextMenu(null);
      }
    };
    const dismissByEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMachiContextMenu(null);
    };
    window.addEventListener("mousedown", dismiss);
    window.addEventListener("keydown", dismissByEsc);
    return () => {
      window.removeEventListener("mousedown", dismiss);
      window.removeEventListener("keydown", dismissByEsc);
    };
  }, [machiContextMenu]);

  return (
    <>
      <aside className="flex h-full w-full flex-col bg-surface-sidebar">
        {/* macOS traffic-light row: toggle + search aligned to the right edge,
            adjacent to the main-area divider (where 本地 sits on the Topbar). */}
        <div className="drag-region agx-sidebar-topbar">
          <TopbarLeftControls
            onToggleSidebar={onToggleSidebar}
            toggleTitle="收起侧栏"
            className="agx-topbar-left-controls no-drag"
          />
        </div>

        {/* Meta-Agent brand row */}
        <button
          className={`group flex w-full items-center gap-2.5 px-4 py-2.5 text-left transition-colors ${
            metaPaneActive ? "" : "hover:bg-surface-hover"
          }`}
          aria-current={metaPaneActive ? "page" : undefined}
          onClick={() => openMetaOrAvatarPane(null, META_AGENT_DISPLAY_NAME)}
          onContextMenu={(e) => {
            e.preventDefault();
            setMachiContextMenu({ x: e.clientX, y: e.clientY });
          }}
        >
          <img
            src={metaAvatarUrl.trim() || DEFAULT_META_AVATAR_URL}
            alt={APP_DISPLAY_NAME}
            className="h-8 w-8 shrink-0 rounded-[7px] object-cover"
          />
          <div className="flex min-w-0 items-baseline gap-1.5">
            <span className="truncate text-[20px] font-bold leading-none text-text-strong">
              {APP_DISPLAY_NAME}
            </span>
            <span className="shrink-0 text-[11px] font-medium leading-none text-text-faint">
              {APP_VERSION}
            </span>
          </div>
        </button>

        {/* Compact button navigation */}
        <nav className="flex flex-col gap-px px-2 py-1.5" aria-label="主导航">
          {NAV_ENTRIES.map((entry) => {
            const Icon = entry.icon;
            const active =
              entry.kind === "action" ? mainView === "chat" : mainView === entry.id;
            return (
              <button
                key={entry.id}
                type="button"
                className={`${NAV_ITEM_BASE} ${active ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE}`}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  if (entry.kind === "action") newMetaTask();
                  else setMainView(entry.id);
                }}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                <span>{entry.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="flex-1" />
      </aside>

      {machiContextMenu && (
        <div
          ref={machiMenuRef}
          className={SIDEBAR_CONTEXT_MENU_CLASS}
          style={{ left: machiContextMenu.x, top: machiContextMenu.y }}
        >
          <button
            type="button"
            className={`${SIDEBAR_CONTEXT_MENU_ITEM_CLASS} text-text-muted hover:bg-surface-hover`}
            onClick={() => {
              setMachiContextMenu(null);
              setMachiSettingsOpen(true);
            }}
          >
            设置
          </button>
        </div>
      )}

      {machiSettingsOpen && (
        <AvatarSettingsPanel
          mode="machi"
          onClose={() => setMachiSettingsOpen(false)}
          onSaved={() => void refreshAvatars()}
        />
      )}
    </>
  );
}
