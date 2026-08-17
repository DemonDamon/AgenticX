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
  FolderOpen,
  PanelRightOpen,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";
import type { ConfirmStrategy, Taskspace } from "../store";
import {
  CONFIRM_STRATEGY_OPTIONS,
  confirmStrategyLabel,
} from "../constants/confirm-strategy-options";

const MENU_WIDTH = 288;

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
  workspaceError?: string;
  onWorkspaceMenuOpen: () => void | Promise<void>;
  onWorkspaceSelect: (taskspaceId: string) => void;
  onOpenWorkspacePanel: () => void;
  confirmStrategy: ConfirmStrategy;
  permissionSaving?: boolean;
  permissionError?: string;
  onConfirmStrategyChange: (strategy: ConfirmStrategy) => Promise<boolean>;
};

type OpenMenu = "workspace" | "permission" | null;

export function ComposerContextControls({
  active = true,
  mode,
  workspaces,
  activeTaskspaceId,
  workspacePanelOpen,
  workspaceLoading = false,
  workspaceError = "",
  onWorkspaceMenuOpen,
  onWorkspaceSelect,
  onOpenWorkspacePanel,
  confirmStrategy,
  permissionSaving = false,
  permissionError = "",
  onConfirmStrategyChange,
}: Props) {
  const [openMenu, setOpenMenu] = useState<OpenMenu>(null);
  const [menuPos, setMenuPos] = useState<{ bottom: number; left: number } | null>(null);
  const workspaceButtonRef = useRef<HTMLButtonElement>(null);
  const permissionButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const focusedMenuRef = useRef<OpenMenu>(null);

  const closeMenu = useCallback((restoreFocus = false) => {
    const trigger =
      openMenu === "workspace" ? workspaceButtonRef.current : permissionButtonRef.current;
    focusedMenuRef.current = null;
    setOpenMenu(null);
    setMenuPos(null);
    if (restoreFocus) window.requestAnimationFrame(() => trigger?.focus());
  }, [openMenu]);

  useEffect(() => {
    if (active) return;
    focusedMenuRef.current = null;
    setOpenMenu(null);
    setMenuPos(null);
  }, [active]);

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
      menuRef.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [menuPos, openMenu]);

  const toggleWorkspaceMenu = () => {
    const next = openMenu === "workspace" ? null : "workspace";
    focusedMenuRef.current = null;
    setMenuPos(null);
    setOpenMenu(next);
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
              <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-text-faint">
                当前会话的工作区
              </div>
              <div className="max-h-52 overflow-y-auto">
                {workspaceLoading ? (
                  <div className="px-2.5 py-3 text-[12px] text-text-faint">正在读取工作区…</div>
                ) : workspaces.length > 0 ? (
                  workspaces.map((workspace) => {
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
                        className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                          selected ? "bg-surface-card-strong" : "hover:bg-surface-hover"
                        }`}
                        onClick={() => {
                          onWorkspaceSelect(workspace.id);
                          closeMenu(true);
                        }}
                      >
                        <FolderOpen className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.8} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] text-text-strong">{rowLabel}</span>
                          <span className="block truncate text-[10px] text-text-faint" title={workspace.path}>
                            {workspace.path}
                          </span>
                        </span>
                        {selected ? <Check className="h-4 w-4 shrink-0 text-theme" strokeWidth={2} /> : null}
                      </button>
                    );
                  })
                ) : (
                  <div className="px-2.5 py-3 text-[12px] leading-5 text-text-faint">
                    {workspaceError || "还没有可选工作区，可进入工作区面板添加文件或目录。"}
                  </div>
                )}
              </div>
              {workspaceError && workspaces.length > 0 ? (
                <div className="px-2.5 py-1 text-[11px] text-status-warning">{workspaceError}</div>
              ) : null}
              <div className="my-1 border-t border-[var(--border-muted)]" />
              <button
                type="button"
                role="menuitem"
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-text-standard transition-colors hover:bg-surface-hover"
                onClick={() => {
                  closeMenu(false);
                  onOpenWorkspacePanel();
                }}
              >
                <PanelRightOpen className="h-4 w-4 shrink-0 text-text-muted" strokeWidth={1.8} />
                <span>管理工作区</span>
              </button>
            </>
          ) : (
            <>
              <div className="px-2.5 pb-1.5 pt-1 text-[11px] font-medium text-text-faint">
                默认执行权限 · 对所有会话生效
              </div>
              {CONFIRM_STRATEGY_OPTIONS.map((option, index) => {
                const selected = confirmStrategy === option.value;
                const StrategyIcon = option.value === "auto" ? TriangleAlert : ShieldCheck;
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
                      className={`mt-0.5 h-4 w-4 shrink-0 ${
                        option.value === "auto" ? "text-status-warning" : "text-text-muted"
                      }`}
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
      className={`flex h-7 min-w-0 max-w-[220px] items-center gap-1.5 rounded-lg px-2 text-[11px] transition-colors ${
        openMenu === "workspace" || workspacePanelOpen
          ? "bg-surface-hover text-text-strong"
          : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
      }`}
      onClick={toggleWorkspaceMenu}
      title={`工作区：${activeWorkspaceLabel}`}
      aria-haspopup="menu"
      aria-expanded={openMenu === "workspace"}
    >
      <FolderOpen className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
      <span className="min-w-0 truncate">{activeWorkspaceLabel}</span>
      <ChevronDown
        className={`h-3 w-3 shrink-0 transition-transform ${openMenu === "workspace" ? "rotate-180" : ""}`}
        strokeWidth={2}
        aria-hidden
      />
    </button>
  );

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
      <ShieldCheck className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
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
        <div className="flex min-w-0 items-center gap-1.5 px-2.5 pb-2.5 pt-1">
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
