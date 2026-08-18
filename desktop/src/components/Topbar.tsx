import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Gauge, LogIn, LogOut, Moon, Settings, Sun, User } from "lucide-react";
import { useAppStore } from "../store";
import { TopbarLeftControls } from "./TopbarLeftControls";
import { BackendModeChip } from "./BackendModeChip";

type Props = {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

export function TopbarContextControls({ sidebarCollapsed, onToggleSidebar }: Props) {
  const chatReturnSnapshot = useAppStore((s) => s.chatReturnSnapshot);
  const returnToPreviousChat = useAppStore((s) => s.returnToPreviousChat);

  return (
    <>
      {sidebarCollapsed ? (
        <TopbarLeftControls
          onToggleSidebar={onToggleSidebar}
          toggleTitle="展开侧栏"
          className="agx-topbar-left-controls agx-topbar-left-controls--collapsed"
        />
      ) : null}
      <BackendModeChip />
      {chatReturnSnapshot ? (
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-[12px] font-medium text-text-faint transition-colors hover:bg-surface-hover hover:text-text-strong"
          onClick={returnToPreviousChat}
          aria-label="返回"
        >
          <ArrowLeft className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} />
          <span>返回</span>
        </button>
      ) : null}
    </>
  );
}

export function TopbarGlobalActions({
  showUsageDashboard = true,
}: { showUsageDashboard?: boolean } = {}) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const openSettings = useAppStore((s) => s.openSettings);
  const openTokenDashboard = useAppStore((s) => s.openTokenDashboard);
  const userAccount = useAppStore((s) => s.userAccount);
  const setUserAccount = useAppStore((s) => s.setUserAccount);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const isDarkLike = theme === "dark" || theme === "dim";

  const onThemeToggle = () => {
    // Topbar 快速切换仅在 dark/light 之间切换，dim 仍保留在「设置」里可选
    setTheme(isDarkLike ? "light" : "dark");
  };

  const onLoginClick = () => {
    openSettings("account");
  };

  const onLogoutClick = async () => {
    setUserMenuOpen(false);
    const r = await window.agenticxDesktop.confirmDialog({
      title: "退出用户账号",
      message: "确定要清除本机已保存的登录状态吗？退出后将恢复本地模型配置。",
      confirmText: "退出",
      destructive: true,
    });
    if (!r.confirmed) return;
    await window.agenticxDesktop.userAccountLogout();
    setUserAccount({ loggedIn: false, email: "", displayName: "", baseUrl: "" });
  };

  const onViewAccount = () => {
    setUserMenuOpen(false);
    openSettings("account");
  };

  // 点击外部关闭用户菜单
  useEffect(() => {
    if (!userMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!userMenuRef.current) return;
      if (!userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [userMenuOpen]);

  const userInitial = (userAccount.displayName || userAccount.email || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <>
      {showUsageDashboard ? (
        <button
          className="agx-topbar-btn agx-topbar-btn--icon-only"
          type="button"
          onClick={() => openTokenDashboard()}
          title="Token 消耗看板"
          aria-label="Token 消耗看板"
        >
          <Gauge className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
      ) : null}
      <button
        className="agx-topbar-btn agx-topbar-btn--icon-only"
        onClick={onThemeToggle}
        title={isDarkLike ? "切换到亮色" : "切换到暗色"}
        aria-label={isDarkLike ? "切换到亮色" : "切换到暗色"}
      >
        {isDarkLike ? (
          <Sun className="h-[18px] w-[18px]" strokeWidth={1.8} />
        ) : (
          <Moon className="h-[18px] w-[18px]" strokeWidth={1.8} />
        )}
      </button>
      <button
        className="agx-topbar-btn agx-topbar-btn--icon-only"
        onClick={() => openSettings()}
        title="设置"
        aria-label="设置"
      >
        <Settings className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </button>
      {userAccount.loggedIn ? (
        <div ref={userMenuRef} className="relative">
          <button
            className="agx-topbar-btn"
            onClick={() => setUserMenuOpen((v) => !v)}
            title={userAccount.displayName || userAccount.email || "已登录"}
            aria-label="账号菜单"
          >
            <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-[rgba(var(--theme-color-rgb),0.9)] text-[10px] font-semibold text-[var(--theme-color-text)]">
              {userInitial}
            </span>
            <span className="agx-topbar-account-label max-w-[120px] truncate text-[12px]">
              {userAccount.displayName || userAccount.email}
            </span>
          </button>
          {userMenuOpen ? (
            <div className="absolute right-0 top-[34px] z-50 min-w-[200px] overflow-hidden rounded-xl bg-surface-base p-1.5 shadow-xl">
              <button
                type="button"
                className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
                onClick={onViewAccount}
              >
                <User
                  className="h-[15px] w-[15px] shrink-0 text-text-muted group-hover:text-text-strong"
                  strokeWidth={2}
                />
                <span className="flex-1 text-[13px] font-medium leading-none text-text-strong">
                  查看账号
                </span>
              </button>
              <button
                type="button"
                className="group mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-rose-500/10"
                onClick={() => void onLogoutClick()}
              >
                <LogOut
                  className="h-[15px] w-[15px] shrink-0 text-rose-400"
                  strokeWidth={2}
                />
                <span className="flex-1 text-[13px] font-medium leading-none text-rose-400">
                  退出登录
                </span>
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <button
          className="agx-topbar-btn"
          onClick={onLoginClick}
          title="登录用户账号"
          aria-label="登录"
        >
          <LogIn className="h-[18px] w-[18px]" strokeWidth={1.8} />
          <span className="agx-topbar-account-label text-[12px]">登录</span>
        </button>
      )}
    </>
  );
}

export function Topbar({ sidebarCollapsed, onToggleSidebar }: Props) {
  const mainView = useAppStore((s) => s.mainView);
  /** Landing pages: hide topbar bottom border so 「本地」下不出现横线。 */
  const hideTopbarBorder = mainView !== "chat";

  return (
    <div className={`agx-topbar${hideTopbarBorder ? " agx-topbar--no-border" : ""}`}>
      <div className="agx-topbar-left">
        <TopbarContextControls
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={onToggleSidebar}
        />
      </div>
      <div className="agx-topbar-right">
        <TopbarGlobalActions />
      </div>
    </div>
  );
}
