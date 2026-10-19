import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { FolderOpen, FolderPlus, Plus, Shrink, Waypoints } from "lucide-react";
import { useAppStore } from "../../store";
import { usePaneNavigation } from "../../hooks/usePaneNavigation";
import {
  formatSidebarRelativeTime,
  getSidebarSessionActivityTs,
  sidebarSessionLabel,
  type SidebarSessionRow,
} from "../../utils/sidebar-session-history";
import { HoverTip } from "../ds/HoverTip";

const SPACES_EXPANDED_KEY = "agx-sidebar-spaces-expanded-v1";

export type SidebarLocalSpace = {
  id: string;
  name: string;
  path: string;
  created_at: number;
};

export type SidebarProjectRow = {
  id: string;
  name: string;
};

type MenuState = { spaceId: string; x: number; y: number } | null;
type SpaceMenuAction = "reveal" | "remove";

type Props = {
  rowsBySpace: Record<string, SidebarSessionRow[]>;
  onOpenSession: (row: SidebarSessionRow) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  spaces?: SidebarLocalSpace[];
  projects?: SidebarProjectRow[];
  enterpriseLoggedIn?: boolean;
};

function loadExpanded(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(SPACES_EXPANDED_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function countLabel(title: string, count: number, english: boolean): string {
  return english ? `${title} (${count})` : `${title}（${count}）`;
}

export function SidebarSpaces({
  rowsBySpace,
  onOpenSession,
  collapsed = false,
  onToggleCollapsed,
  spaces: spacesProp,
  projects: projectsProp,
  enterpriseLoggedIn: loggedInProp,
}: Props) {
  const { t, i18n } = useTranslation("sidebar");
  const openProject = useAppStore((s) => s.openProject);
  const { newMetaTask } = usePaneNavigation();
  const [loadedSpaces, setLoadedSpaces] = useState<SidebarLocalSpace[]>([]);
  const [loadedProjects, setLoadedProjects] = useState<SidebarProjectRow[]>([]);
  const [loadedLoggedIn, setLoadedLoggedIn] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>(() => loadExpanded());
  const [menu, setMenu] = useState<MenuState>(null);

  const spaces = spacesProp ?? loadedSpaces;
  const loggedIn = loggedInProp ?? loadedLoggedIn;
  const projects = loggedIn ? (projectsProp ?? loadedProjects) : [];
  const count = spaces.length + projects.length;
  const english = i18n.language.startsWith("en");

  const reload = useCallback(async () => {
    if (spacesProp !== undefined && projectsProp !== undefined && loggedInProp !== undefined) return;
    try {
      if (spacesProp === undefined) {
        const listed = await window.agenticxDesktop.localSpacesList();
        setLoadedSpaces(Array.isArray(listed?.spaces) ? listed.spaces : []);
      }
    } catch (err) {
      console.warn("[SidebarSpaces] localSpacesList failed", err);
    }
    try {
      if (loggedInProp === undefined) {
        const account = await window.agenticxDesktop.loadEnterpriseAccount();
        setLoadedLoggedIn(Boolean(account.ok && account.loggedIn));
      }
    } catch {
      if (loggedInProp === undefined) setLoadedLoggedIn(false);
    }
    try {
      if (projectsProp === undefined) {
        const listed = await window.agenticxDesktop.collabProjectList();
        if (listed.ok && listed.data?.projects) {
          setLoadedProjects(listed.data.projects.map((project) => ({ id: project.id, name: project.name })));
        } else if (listed.error === "enterprise-login-required") {
          setLoadedProjects([]);
          if (loggedInProp === undefined) setLoadedLoggedIn(false);
        }
      }
    } catch (err) {
      console.warn("[SidebarSpaces] collabProjectList failed", err);
    }
  }, [loggedInProp, projectsProp, spacesProp]);

  useEffect(() => {
    void reload();
    const onChanged = () => {
      void reload();
    };
    window.addEventListener("agenticx:spaces:changed", onChanged);
    const offAccount = window.agenticxDesktop?.onEnterpriseAccountChanged?.(() => {
      void reload();
    });
    return () => {
      window.removeEventListener("agenticx:spaces:changed", onChanged);
      offAccount?.();
    };
  }, [reload]);

  useEffect(() => {
    try {
      localStorage.setItem(SPACES_EXPANDED_KEY, JSON.stringify(expanded));
    } catch {
      /* ignore */
    }
  }, [expanded]);

  useEffect(() => {
    if (!menu) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-space-menu]")) return;
      setMenu(null);
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menu]);

  const toggleSpace = (spaceId: string) => {
    setExpanded((prev) => ({ ...prev, [spaceId]: !prev[spaceId] }));
  };

  const collapseAll = () => {
    const next: Record<string, boolean> = {};
    for (const space of spaces) next[space.id] = false;
    setExpanded(next);
  };

  const createSpace = async () => {
    const picked = await window.agenticxDesktop.chooseDirectory();
    if (!picked.ok || picked.canceled || !picked.path) return;
    try {
      const created = await window.agenticxDesktop.localSpacesCreate({ path: picked.path });
      if (!created.ok) {
        console.warn("[SidebarSpaces] create failed", created.error);
        return;
      }
      setExpanded((prev) => ({ ...prev, [created.space.id]: true }));
      window.dispatchEvent(new CustomEvent("agenticx:spaces:changed"));
      await reload();
    } catch (err) {
      console.warn("[SidebarSpaces] create failed", err);
    }
  };

  const removeSpace = async (spaceId: string) => {
    try {
      await window.agenticxDesktop.localSpacesRemove({ id: spaceId });
      window.dispatchEvent(new CustomEvent("agenticx:spaces:changed"));
      await reload();
    } catch (err) {
      console.warn("[SidebarSpaces] remove failed", err);
    }
  };

  const runMenu = (action: SpaceMenuAction, space: SidebarLocalSpace) => {
    switch (action) {
      case "reveal":
        void window.agenticxDesktop.shellShowItemInFolder(space.path);
        break;
      case "remove":
        void removeSpace(space.id);
        break;
      default: {
        const _never: never = action;
        return _never;
      }
    }
    setMenu(null);
  };

  const menuSpace = menu ? spaces.find((space) => space.id === menu.spaceId) ?? null : null;

  return (
    <div className="mt-2">
      <div className="flex items-center gap-1 px-2 py-1">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center text-left text-[11px] font-semibold tracking-[0.06em] text-text-faint"
          onClick={() => onToggleCollapsed?.()}
        >
          <span className="truncate uppercase">{countLabel(t("spaces.title"), count, english)}</span>
        </button>
        {count > 0 ? (
          <HoverTip label={t("spaces.collapseAll")}>
            <button
              type="button"
              className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-strong"
              aria-label={t("spaces.collapseAll")}
              onClick={collapseAll}
            >
              <Shrink className="h-3.5 w-3.5" strokeWidth={1.8} />
            </button>
          </HoverTip>
        ) : null}
        <HoverTip label={t("spaces.create")}>
          <button
            type="button"
            className="inline-flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover hover:text-text-strong"
            aria-label={t("spaces.create")}
            onClick={() => void createSpace()}
          >
            <FolderPlus className="h-3.5 w-3.5" strokeWidth={1.8} />
          </button>
        </HoverTip>
      </div>

      {collapsed ? null : (
        <div className="mb-1">
          {spaces.map((space) => {
            const open = expanded[space.id] === true;
            const rows = rowsBySpace[space.id] ?? [];
            return (
              <div key={space.id}>
                <div
                  className="group/space flex h-8 w-full items-center gap-1 rounded-md pr-2 text-[13px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ spaceId: space.id, x: event.clientX, y: event.clientY });
                  }}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-1.5 truncate px-2 text-left"
                    onClick={() => toggleSpace(space.id)}
                  >
                    <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
                    <span className="min-w-0 flex-1 truncate">{space.name}</span>
                  </button>
                  <HoverTip label={t("spaces.newTaskHere")}>
                    <button
                      type="button"
                      className="hidden h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-card hover:text-text-strong group-hover/space:inline-flex"
                      aria-label={t("spaces.newTaskHere")}
                      onClick={(event) => {
                        event.stopPropagation();
                        newMetaTask(undefined, { spaceId: space.id });
                      }}
                    >
                      <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />
                    </button>
                  </HoverTip>
                </div>
                {open
                  ? rows.map((row) => {
                      const title = sidebarSessionLabel(row);
                      const relative = formatSidebarRelativeTime(getSidebarSessionActivityTs(row));
                      return (
                        <button
                          key={row.session_id}
                          type="button"
                          className="agx-session-history-row flex h-8 w-full items-center gap-1 rounded-md pr-2 pl-7 text-left text-[13px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
                          onClick={() => onOpenSession(row)}
                        >
                          <span className="min-w-0 flex-1 truncate">{title}</span>
                          {relative ? (
                            <span className="shrink-0 text-[11px] tabular-nums text-text-faint">{relative}</span>
                          ) : null}
                        </button>
                      );
                    })
                  : null}
              </div>
            );
          })}
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className="flex h-8 w-full items-center gap-1.5 rounded-md px-2 text-left text-[13px] text-text-muted hover:bg-surface-hover hover:text-text-strong"
              onClick={() => openProject(project.id)}
            >
              <Waypoints className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
            </button>
          ))}
        </div>
      )}

      {menu && menuSpace
        ? createPortal(
            <div
              data-space-menu
              className="fixed z-[230] w-[160px] rounded-md border border-border bg-surface-base py-1 shadow-2xl"
              style={{ left: menu.x, top: menu.y }}
            >
              {(
                [
                  { id: "reveal" as const, label: t("spaces.reveal") },
                  { id: "remove" as const, label: t("spaces.remove") },
                ]
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className="w-full whitespace-nowrap px-3 py-1.5 text-left text-[13px] text-text-muted hover:bg-surface-hover"
                  onClick={() => runMenu(item.id, menuSpace)}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
