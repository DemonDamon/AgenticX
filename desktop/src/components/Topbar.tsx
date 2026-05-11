import { useEffect, useRef, useState } from "react";
import { Activity, LogIn, LogOut, Moon, PanelLeftOpen, Settings, Sun, User } from "lucide-react";
import { useAppStore } from "../store";

function FocusModeLogo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <rect x="2" y="4" width="20" height="13" rx="2" />
      <path d="M12 17v4" />
      <path d="M8 21h8" />
      <path d="M12 10.5c-1-1.33-2-2-3-2a2 2 0 1 0 0 4c1 0 2-.67 3-2Zm0 0c1 1.33 2 2 3 2a2 2 0 1 0 0-4c-1 0-2 .67-3 2Z" />
    </svg>
  );
}

type Props = {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
};

export function Topbar({ sidebarCollapsed, onToggleSidebar }: Props) {
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const openSettings = useAppStore((s) => s.openSettings);
  const openTokenDashboard = useAppStore((s) => s.openTokenDashboard);
  const toggleFocusMode = useAppStore((s) => s.toggleFocusMode);
  const agxAccount = useAppStore((s) => s.agxAccount);
  const setAgxAccount = useAppStore((s) => s.setAgxAccount);

  const [loginBusy, setLoginBusy] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  const isDarkLike = theme === "dark" || theme === "dim";

  const onThemeToggle = () => {
    // Topbar 快速切换仅在 dark/light 之间切换，dim 仍保留在「设置」里可选
    setTheme(isDarkLike ? "light" : "dark");
    try {
      window.localStorage.setItem("agx-theme", isDarkLike ? "light" : "dark");
    } catch {
      // ignore storage errors
    }
  };

  const onLoginClick = async () => {
    if (loginBusy) return;
    setLoginBusy(true);
    try {
      const r = await window.agenticxDesktop.agxAccountLoginStart();
      if (!r.ok) {
        await window.agenticxDesktop.confirmDialog({
          title: "无法开始登录",
          message: "未能开始官网账号登录，请稍后再试。",
          detail: typeof r.error === "string" && r.error ? `错误：${r.error}` : undefined,
          confirmText: "确定",
        });
      }
    } catch (err) {
      await window.agenticxDesktop.confirmDialog({
        title: "无法开始登录",
        message: String(err),
        confirmText: "确定",
      });
    } finally {
      setLoginBusy(false);
    }
  };

  const onLogoutClick = async () => {
    setUserMenuOpen(false);
    const r = await window.agenticxDesktop.confirmDialog({
      title: "退出官网账号",
      message: "确定要清除本机已保存的 Machi 官网登录状态吗？",
      confirmText: "退出",
      destructive: true,
    });
    if (!r.confirmed) return;
    await window.agenticxDesktop.agxAccountLogout();
    setAgxAccount({ loggedIn: false, email: "", displayName: "" });
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

  const userInitial = (agxAccount.displayName || agxAccount.email || "?")
    .trim()
    .charAt(0)
    .toUpperCase();

  return (
    <div className="agx-topbar">
      <div className={`agx-topbar-left ${sidebarCollapsed ? "agx-topbar-left--collapsed" : ""}`}>
        <button
          className="agx-topbar-btn agx-topbar-btn--icon-only"
          onClick={onToggleSidebar}
          title={sidebarCollapsed ? "展开侧栏" : "收起侧栏"}
        >
          <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
      </div>
      <div className="agx-topbar-right">
        <button
          className="agx-topbar-btn agx-topbar-btn--icon-only"
          onClick={toggleFocusMode}
          title="灵巧模式 (⇧⌘F)"
          aria-label="进入灵巧模式"
        >
          <FocusModeLogo className="h-[18px] w-[18px] opacity-80" />
        </button>
        <button
          className="agx-topbar-btn agx-topbar-btn--icon-only"
          type="button"
          onClick={() => openTokenDashboard()}
          title="Token 消耗看板"
          aria-label="Token 消耗看板"
        >
          <Activity className="h-[18px] w-[18px]" strokeWidth={1.8} />
        </button>
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
        {agxAccount.loggedIn ? (
          <div ref={userMenuRef} className="relative">
            <button
              className="agx-topbar-btn"
              onClick={() => setUserMenuOpen((v) => !v)}
              title={agxAccount.displayName || agxAccount.email || "已登录"}
              aria-label="账号菜单"
            >
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-400/90 text-[10px] font-semibold text-black">
                {userInitial}
              </span>
              <span className="max-w-[120px] truncate text-[12px]">
                {agxAccount.displayName || agxAccount.email}
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
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="text-[13px] font-medium leading-none text-text-strong">查看账号</span>
                    <span className="text-[11px] leading-none text-text-faint">设置与用量</span>
                  </span>
                </button>
                <button
                  type="button"
                  className="group mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-rose-500/10"
                  onClick={() => void onLogoutClick()}
                >
                  <LogOut className="h-[15px] w-[15px] shrink-0 text-rose-400" strokeWidth={2} />
                  <span className="flex flex-1 flex-col gap-0.5">
                    <span className="text-[13px] font-medium leading-none text-rose-400">退出登录</span>
                    <span className="text-[11px] leading-none text-rose-400/70">清除本机登录状态</span>
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        ) : (
          <button
            className="agx-topbar-btn"
            onClick={() => void onLoginClick()}
            disabled={loginBusy}
            title="登录 Machi 官网账号"
            aria-label="登录"
          >
            <LogIn className="h-[18px] w-[18px]" strokeWidth={1.8} />
            <span className="text-[12px]">{loginBusy ? "登录中..." : "登录"}</span>
          </button>
        )}
      </div>
    </div>
  );
}
