import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  CircleQuestionMark,
  Folder,
  FolderOpen,
  Plus,
  Search,
  ShieldCheck,
  Zap,
} from "lucide-react";
import type { ConfirmStrategy, Taskspace } from "../store";
import {
  CONFIRM_STRATEGY_OPTIONS,
  confirmStrategyLabel,
} from "../constants/confirm-strategy-options";

const MENU_WIDTH = 272;

function normalizeWorkspaceSearch(value: string): string {
  return value.normalize("NFKC").trim().toLocaleLowerCase();
}

export function filterComposerWorkspaces(
  workspaces: Taskspace[],
  query: string,
): Taskspace[] {
  const normalizedQuery = normalizeWorkspaceSearch(query);
  if (!normalizedQuery) return workspaces;
  return workspaces.filter((workspace) =>
    [workspace.label, workspace.path].some((value) =>
      normalizeWorkspaceSearch(String(value || "")).includes(normalizedQuery),
    ),
  );
}

export function composerWorkspaceLabel(
  workspaces: Taskspace[],
  activeTaskspaceId: string | null,
): string {
  const active =
    workspaces.find((item) => item.id === activeTaskspaceId) ??
    (activeTaskspaceId ? undefined : workspaces[0]);
  if (active) {
    const raw = String(active.label || "").trim();
    if (active.id === "default" || !raw || raw.toLowerCase() === "default") {
      return "会话工作区";
    }
    return raw;
  }
  if (activeTaskspaceId === "default") return "会话工作区";
  return "选择工作区";
}

export function defaultWorkspacePath(workspaces: Taskspace[]): string {
  return String(
    workspaces.find((item) => item.id === "default")?.path ?? workspaces[0]?.path ?? "",
  ).trim();
}

function workspacePathSeparator(path: string): "/" | "\\" {
  return path.includes("\\") && !path.includes("/") ? "\\" : "/";
}

export function workspaceDraftPath(basePath: string, label: string): string {
  const base = String(basePath || "").trim().replace(/[\\/]+$/, "");
  if (!base) return "";
  const segment = String(label || "")
    .normalize("NFKC")
    .trim()
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "") || "新工作区";
  return `${base}${workspacePathSeparator(base)}${segment}`;
}

export function composerPermissionLabel(strategy: ConfirmStrategy): string {
  return confirmStrategyLabel(strategy);
}

type Props = {
  active?: boolean;
  mode: "new-topic" | "conversation";
  workspaces: Taskspace[];
  activeTaskspaceId: string | null;
  workspacePanelOpen: boolean;
  workspaceLoading?: boolean;
  workspaceActionBusy?: boolean;
  workspaceError?: string;
  onWorkspaceMenuOpen: () => void | Promise<void>;
  onWorkspaceSelect: (taskspaceId: string) => void;
  onCreateWorkspace: (path: string, label: string) => Promise<boolean>;
  onOpenLocalFolder: () => Promise<boolean>;
  confirmStrategy: ConfirmStrategy;
  permissionSaving?: boolean;
  permissionError?: string;
  onConfirmStrategyChange: (strategy: ConfirmStrategy) => Promise<boolean>;
};

type OpenMenu = "workspace" | "permission" | null;

function permissionStrategyVisual(strategy: ConfirmStrategy) {
  if (strategy === "manual") {
    return { Icon: CircleQuestionMark, iconClassName: "text-text-muted" };
  }
  if (strategy === "semi-auto") {
    return { Icon: ShieldCheck, iconClassName: "text-[var(--settings-accent-fg)]" };
  }
  return { Icon: Zap, iconClassName: "text-status-warning" };
}

export function ComposerContextControls({
  active = true,
  mode,
  workspaces,
  activeTaskspaceId,
  workspacePanelOpen,
  workspaceLoading = false,
  workspaceActionBusy = false,
  workspaceError = "",
  onWorkspaceMenuOpen,
  onWorkspaceSelect,
  onCreateWorkspace,
  onOpenLocalFolder,
  confirmStrategy,
  permissionSaving = false,
  permissionError = "",
  onConfirmStrategyChange,
}: Props) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [menuPos, setMenuPos] = useState<{ bottom: number; left: number } | null>(null);
  const [workspaceQuery, setWorkspaceQuery] = useState("");
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [newWorkspacePath, setNewWorkspacePath] = useState("");
  const [newWorkspaceLabel, setNewWorkspaceLabel] = useState("");
  const [workspacePathFollowsLabel, setWorkspacePathFollowsLabel] = useState(true);
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);
  const permissionButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const workspaceSearchRef = useRef<HTMLInputElement>(null);
  const newWorkspaceLabelRef = useRef<HTMLInputElement>(null);
  const newWorkspacePathRef = useRef<HTMLInputElement>(null);
  const focusedMenuRef = useRef<OpenMenu>(null);

  const resetWorkspaceMenu = useCallback(() => {
    setWorkspaceQuery("");
    setShowCreateWorkspace(false);
    setNewWorkspacePath("");
    setNewWorkspaceLabel("");
    setWorkspacePathFollowsLabel(true);
  }, []);

  const sessionWorkspacePath = defaultWorkspacePath(workspaces);
  useEffect(() => {
    if (!showCreateWorkspace || !workspacePathFollowsLabel || !sessionWorkspacePath) return;
    setNewWorkspacePath(workspaceDraftPath(sessionWorkspacePath, newWorkspaceLabel));
  }, [newWorkspaceLabel, sessionWorkspacePath, showCreateWorkspace, workspacePathFollowsLabel]);

  const closeMenu = useCallback((restoreFocus = false) => {
    const trigger =
      openMenu === "workspace" ? workspaceButtonRef.current : permissionButtonRef.current;
    focusedMenuRef.current = null;
    setOpenMenu(null);
    setMenuPos(null);
    if (openMenu === "workspace") resetWorkspaceMenu();
    if (restoreFocus) window.requestAnimationFrame(() => trigger?.focus());
  }, [openMenu, resetWorkspaceMenu]);

  useEffect(() => {
    if (active) return;
    focusedMenuRef.current = null;
    setOpenMenu(null);
    setMenuPos(null);
    resetWorkspaceMenu();
  }, [active, resetWorkspaceMenu]);

  const syncPosition = useCallback(() => {
    const anchor =
      openMenu === "workspace" ? workspaceButtonRef.current : permissionButtonRef.current;
    const rect = anchor?.getBoundingClientRect();
    if (!rect) return;
    const viewportGap = 8;
    setMenuPos({
      bottom: window.innerHeight - rect.top + 6,
      left: Math.max(
        viewportGap,
        Math.min(rect.left, window.innerWidth - MENU_WIDTH - viewportGap),
      ),
    });
  }, [openMenu]);

  useEffect(() => {
    if (!openMenu) return;
    syncPosition();
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (
        workspaceButtonRef.current?.contains(target) ||
        permissionButtonRef.current?.contains(target) ||
        menuRef.current?.contains(target)
      ) {
        return;
      }
      closeMenu(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu(true);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [closeMenu, openMenu, syncPosition]);

  useEffect(() => {
    if (!openMenu || !menuPos || focusedMenuRef.current === openMenu) return;
    focusedMenuRef.current = openMenu;
    const frame = window.requestAnimationFrame(() => {
      if (openMenu === "workspace") {
        workspaceSearchRef.current?.focus();
      } else {
        menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menuPos, openMenu]);

  const toggleWorkspaceMenu = () => {
    const next = openMenu === "workspace" ? null : "workspace";
    focusedMenuRef.current = null;
    setMenuPos(null);
    setOpenMenu(next);
    resetWorkspaceMenu();
    if (next) void onWorkspaceMenuOpen();
  };

  const togglePermissionMenu = () => {
    focusedMenuRef.current = null;
    setMenuPos(null);
    setOpenMenu(openMenu === "permission" ? null : "permission");
  };

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu(true);
      return;
    }
    if (
      event.target instanceof HTMLInputElement &&
      (event.key === "Home" || event.key === "End")
    ) {
      return;
    }
    if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
    const items = Array.from(
      menuRef.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? [],
    );
    if (items.length === 0) return;
    event.preventDefault();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    let nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    else if (event.key === "ArrowUp") {
      nextIndex = currentIndex <= 0 ? items.length - 1 : currentIndex - 1;
    } else if (event.key === "ArrowDown") {
      nextIndex = currentIndex < 0 || currentIndex === items.length - 1 ? 0 : currentIndex + 1;
    }
    items[nextIndex]?.focus();
  };

  const activeWorkspaceLabel = composerWorkspaceLabel(workspaces, activeTaskspaceId);
  const activeWorkspace =
    workspaces.find((item) => item.id === activeTaskspaceId) ??
    (activeTaskspaceId ? undefined : workspaces[0]);
  const filteredWorkspaces = filterComposerWorkspaces(workspaces, workspaceQuery);
  const permissionLabel = composerPermissionLabel(confirmStrategy);
  const permissionIsAuto = confirmStrategy === "auto";

  const menu = openMenu && menuPos
    ? createPortal(
        <div
          ref={menuRef}
          className="agx-menu-pop fixed z-[9999] w-72 overflow-hidden rounded-xl border border-border bg-surface-panel p-1.5 shadow-xl backdrop-blur-xl"
          style={{
            width: MENU_WIDTH,
            bottom: menuPos.bottom,
            left: menuPos.left,
            transformOrigin: "bottom left",
          }}
          role="menu"
          aria-label={openMenu === "workspace" ? "选择工作区" : "选择执行权限"}
          onKeyDown={handleMenuKeyDown}
        >
          {openMenu === "workspace" ? (
            <>
              <div className="relative mb-1.5">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-faint"
                  strokeWidth={1.8}
                  aria-hidden
                />
                <input
                  ref={workspaceSearchRef}
                  value={workspaceQuery}
                  onChange={(event) => setWorkspaceQuery(event.target.value)}
                  placeholder="搜索工作区"
                  aria-label="搜索工作区"
                  className="h-8 w-full rounded-lg border border-border bg-surface-card pl-8 pr-2.5 text-[12px] text-text-strong outline-none placeholder:text-text-faint focus:border-[var(--settings-accent-border)]"
                />
              </div>
              <div className="max-h-56 overflow-y-auto">
                {workspaceLoading ? (
                  <div className="px-2.5 py-3 text-[12px] text-text-faint">正在读取工作区…</div>
                ) : filteredWorkspaces.length > 0 ? (
                  filteredWorkspaces.map((workspace) => {
                    const selected =
                      workspace.id === activeTaskspaceId ||
                      (!activeTaskspaceId && workspace === workspaces[0]);
                    const rowLabel = composerWorkspaceLabel([workspace], workspace.id);
                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        role="menuitemradio"
                        aria-checked={selected}
                        title={workspace.path}
                        className={`flex min-h-10 w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                          selected ? "bg-surface-card-strong" : "hover:bg-surface-hover"
                        }`}
                        onClick={() => {
                          onWorkspaceSelect(workspace.id);
                          closeMenu(true);
                        }}
                      >
                        <Folder className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.8} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-text-strong">
                            {rowLabel}
                          </span>
                          <span className="block truncate text-[10px] text-text-faint">
                            {workspace.path}
                          </span>
                        </span>
                        {selected ? <Check className="h-4 w-4 shrink-0 text-theme" strokeWidth={2} /> : null}
                      </button>
                    );
                  })
                ) : (
                  <div className="px-2.5 py-3 text-[12px] text-text-faint">
                    {workspaceQuery.trim() ? "没有匹配的工作区" : "暂无可选工作区"}
                  </div>
                )}
              </div>
              {workspaceError ? (
                <div className="px-2.5 py-1 text-[11px] text-status-warning">{workspaceError}</div>
              ) : null}
              <div className="my-1 border-t border-[var(--border-muted)]" />
              {showCreateWorkspace ? (
                <form
                  className="rounded-lg bg-surface-card p-2"
                  onSubmit={async (event) => {
                    event.preventDefault();
                    if (!newWorkspaceLabel.trim() || !newWorkspacePath.trim() || workspaceActionBusy) return;
                    if (await onCreateWorkspace(newWorkspacePath, newWorkspaceLabel)) {
                      closeMenu(true);
                    }
                  }}
                >
                  <div className="mb-1.5 text-[11px] font-medium text-text-muted">新建工作区</div>
                  <input
                    ref={newWorkspaceLabelRef}
                    value={newWorkspaceLabel}
                    onChange={(event) => {
                      const nextLabel = event.target.value;
                      setNewWorkspaceLabel(nextLabel);
                      if (workspacePathFollowsLabel) {
                        setNewWorkspacePath(workspaceDraftPath(sessionWorkspacePath, nextLabel));
                      }
                    }}
                    placeholder="工作区名称，例如：财报分析"
                    aria-label="新工作区名称"
                    className="mb-1.5 h-8 w-full rounded-md border border-border bg-surface-panel px-2 text-[12px] text-text-strong outline-none placeholder:text-text-faint focus:border-[var(--settings-accent-border)]"
                  />
                  <input
                    ref={newWorkspacePathRef}
                    value={newWorkspacePath}
                    onChange={(event) => {
                      setWorkspacePathFollowsLabel(false);
                      setNewWorkspacePath(event.target.value);
                    }}
                    placeholder="工作区文件路径"
                    aria-label="新工作区目录"
                    className="h-8 w-full rounded-md border border-border bg-surface-panel px-2 text-[12px] text-text-strong outline-none placeholder:text-text-faint focus:border-[var(--settings-accent-border)]"
                  />
                  <div className="mt-1 text-[10px] leading-4 text-text-faint">
                    默认保存在当前会话工作区内；需要时可直接修改路径。
                  </div>
                  <div className="mt-2 flex justify-end gap-1.5">
                    <button
                      type="button"
                      className="h-7 rounded-md px-2 text-[11px] text-text-muted hover:bg-surface-hover"
                      onClick={() => {
                        setShowCreateWorkspace(false);
                        setNewWorkspacePath("");
                        setNewWorkspaceLabel("");
                        setWorkspacePathFollowsLabel(true);
                        window.requestAnimationFrame(() => workspaceSearchRef.current?.focus());
                      }}
                    >
                      取消
                    </button>
                    <button
                      type="submit"
                      disabled={!newWorkspaceLabel.trim() || !newWorkspacePath.trim() || workspaceActionBusy}
                      className="h-7 rounded-md px-2.5 text-[11px] transition-opacity disabled:opacity-45"
                      style={{
                        background: "var(--ui-btn-primary-bg)",
                        color: "var(--ui-btn-primary-text)",
                      }}
                    >
                      {workspaceActionBusy ? "创建中…" : "创建"}
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  disabled={workspaceActionBusy}
                  className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-text-standard transition-colors hover:bg-surface-hover disabled:opacity-50"
                  onClick={() => {
                    setShowCreateWorkspace(true);
                    setNewWorkspaceLabel("");
                    setWorkspacePathFollowsLabel(true);
                    setNewWorkspacePath(workspaceDraftPath(sessionWorkspacePath, ""));
                    window.requestAnimationFrame(() => newWorkspaceLabelRef.current?.focus());
                  }}
                >
                  <Plus className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.8} />
                  <span>新建工作区</span>
                </button>
              )}
              <button
                type="button"
                role="menuitem"
                disabled={workspaceActionBusy}
                className="flex h-8 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[13px] text-text-standard transition-colors hover:bg-surface-hover disabled:opacity-50"
                onClick={async () => {
                  if (await onOpenLocalFolder()) closeMenu(true);
                }}
              >
                <FolderOpen className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.8} />
                <span>{workspaceActionBusy ? "正在添加…" : "打开本地文件夹"}</span>
              </button>
            </>
          ) : (
            <>
              <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-text-faint">
                默认执行权限 · 对所有会话生效
              </div>
              {CONFIRM_STRATEGY_OPTIONS.map((option, index) => {
                const selected = confirmStrategy === option.value;
                const { Icon: StrategyIcon, iconClassName } = permissionStrategyVisual(
                  option.value,
                );
                return (
                  <button
                    key={option.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={selected}
                    disabled={permissionSaving}
                    className={`${index > 0 ? "mt-0.5" : ""} flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2.5 text-left transition-colors disabled:opacity-60 ${
                      selected ? "bg-surface-card-strong" : "hover:bg-surface-hover"
                    }`}
                    onClick={async () => {
                      if (await onConfirmStrategyChange(option.value)) closeMenu(true);
                    }}
                  >
                    <StrategyIcon
                      className={`mt-0.5 h-4 w-4 shrink-0 ${iconClassName}`}
                      strokeWidth={1.8}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium text-text-strong">
                        {option.label}
                      </span>
                      <span className="mt-0.5 block text-[11px] leading-4 text-text-faint">
                        {option.description}
                      </span>
                    </span>
                    {selected ? (
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-theme" strokeWidth={2} />
                    ) : null}
                  </button>
                );
              })}
              {permissionSaving ? (
                <div className="px-2.5 py-1.5 text-[11px] text-text-faint">正在保存…</div>
              ) : permissionError ? (
                <div className="px-2.5 py-1.5 text-[11px] text-status-error">{permissionError}</div>
              ) : null}
            </>
          )}
        </div>,
        document.body,
      )
    : null;

  const workspaceTrigger = (
    <button
      ref={workspaceButtonRef}
      type="button"
      className={`flex h-7 min-w-0 max-w-[360px] items-center gap-1.5 rounded-lg px-2 text-[11px] transition-colors ${
        openMenu === "workspace" || workspacePanelOpen
          ? "bg-surface-hover text-text-strong"
          : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
      }`}
      onClick={toggleWorkspaceMenu}
      title={`工作区：${activeWorkspaceLabel}${activeWorkspace?.path ? `\n${activeWorkspace.path}` : ""}`}
      aria-haspopup="menu"
      aria-expanded={openMenu === "workspace"}
    >
      <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0 truncate">{activeWorkspaceLabel}</span>
      {activeWorkspace?.path ? (
        <span className="hidden min-w-0 truncate text-[10px] text-text-faint md:inline">
          {activeWorkspace.path}
        </span>
      ) : null}
      <ChevronDown
        className={`h-3 w-3 shrink-0 transition-transform ${openMenu === "workspace" ? "rotate-180" : ""}`}
        strokeWidth={2}
        aria-hidden
      />
    </button>
  );

  const { Icon: ActivePermissionIcon, iconClassName: activePermissionIconClassName } =
    permissionStrategyVisual(confirmStrategy);

  const permissionTrigger = (
    <button
      ref={permissionButtonRef}
      type="button"
      className={`flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2 text-[11px] transition-colors ${
        openMenu === "permission" || permissionIsAuto
          ? "bg-surface-hover text-text-strong"
          : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
      }`}
      onClick={togglePermissionMenu}
      title={`默认执行权限：${permissionLabel}`}
      aria-haspopup="menu"
      aria-expanded={openMenu === "permission"}
    >
      <ActivePermissionIcon
        className={`h-3.5 w-3.5 shrink-0 ${activePermissionIconClassName}`}
        strokeWidth={1.8}
        aria-hidden
      />
      <span>{permissionLabel}</span>
      <ChevronDown
        className={`h-3 w-3 shrink-0 transition-transform ${openMenu === "permission" ? "rotate-180" : ""}`}
        strokeWidth={2}
        aria-hidden
      />
    </button>
  );

  return (
    <>
      {mode === "new-topic" ? (
        <div className="flex min-w-0 items-center gap-1.5">
          {workspaceTrigger}
          {permissionTrigger}
        </div>
      ) : (
        permissionTrigger
      )}
      {menu}
    </>
  );
}
