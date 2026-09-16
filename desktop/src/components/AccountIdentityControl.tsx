import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { LogIn, LogOut, User } from "lucide-react";
import { DEFAULT_META_AVATAR_URL } from "../constants/meta-avatar";
import { useAppStore } from "../store";

type Props = {
  variant: "pill" | "topbar";
  menuPlacement: "up" | "down";
  className?: string;
};

function resolveIdentityLabel(opts: {
  userNickname: string;
  displayName: string;
  email: string;
  fallback: string;
}): string {
  const nickname = opts.userNickname.trim();
  if (nickname) return nickname;
  const account = (opts.displayName || opts.email).trim();
  if (account) return account;
  return opts.fallback;
}

export function AccountIdentityControl({ variant, menuPlacement, className = "" }: Props) {
  const { t } = useTranslation("sidebar");
  const { t: tCommon } = useTranslation("common");
  const openSettings = useAppStore((s) => s.openSettings);
  const agxAccount = useAppStore((s) => s.agxAccount);
  const setAgxAccount = useAppStore((s) => s.setAgxAccount);
  const userNickname = useAppStore((s) => s.userNickname);
  const userAvatarUrl = useAppStore((s) => s.userAvatarUrl);

  const [loginBusy, setLoginBusy] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top?: number; bottom?: number; left: number; width: number } | null>(
    null
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const label = resolveIdentityLabel({
    userNickname,
    displayName: agxAccount.displayName,
    email: agxAccount.email,
    fallback: t("identity.me"),
  });
  const onLoginClick = async () => {
    if (loginBusy) return;
    setUserMenuOpen(false);
    setLoginBusy(true);
    try {
      const r = await window.agenticxDesktop.agxAccountLoginStart();
      if (!r.ok) {
        await window.agenticxDesktop.confirmDialog({
          title: t("identity.loginFailedTitle"),
          message: t("identity.loginFailedMessage"),
          detail: typeof r.error === "string" && r.error ? t("identity.errorDetail", { error: r.error }) : undefined,
          confirmText: tCommon("ok"),
        });
      }
    } catch (err) {
      await window.agenticxDesktop.confirmDialog({
        title: t("identity.loginFailedTitle"),
        message: String(err),
        confirmText: tCommon("ok"),
      });
    } finally {
      setLoginBusy(false);
    }
  };

  const onLogoutClick = async () => {
    setUserMenuOpen(false);
    const r = await window.agenticxDesktop.confirmDialog({
      title: t("identity.logoutTitle"),
      message: t("identity.logoutMessage"),
      confirmText: t("identity.logoutConfirm"),
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

  const updateMenuPos = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    if (menuPlacement === "up") {
      setMenuPos({
        bottom: window.innerHeight - rect.top + 6,
        left: Math.max(8, rect.left),
        width: Math.max(200, rect.width),
      });
      return;
    }
    setMenuPos({
      top: rect.bottom + 6,
      left: Math.max(8, rect.right - 200),
      width: 200,
    });
  }, [menuPlacement]);

  useLayoutEffect(() => {
    if (!userMenuOpen) {
      setMenuPos(null);
      return;
    }
    updateMenuPos();
  }, [userMenuOpen, updateMenuPos]);

  useEffect(() => {
    if (!userMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (rootRef.current?.contains(target)) return;
      const menu = document.getElementById("agx-account-identity-menu");
      if (menu?.contains(target)) return;
      setUserMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserMenuOpen(false);
    };
    const onReposition = () => updateMenuPos();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
    };
  }, [userMenuOpen, updateMenuPos]);

  const onTriggerClick = () => {
    if (loginBusy) return;
    setUserMenuOpen((v) => !v);
  };

  const avatar = (
    <img
      src={userAvatarUrl.trim() || DEFAULT_META_AVATAR_URL}
      alt=""
      className="h-5 w-5 shrink-0 rounded-full object-cover"
    />
  );

  const triggerClass =
    variant === "pill"
      ? "flex h-8 min-w-0 w-full items-center gap-2 rounded-xl bg-surface-card-strong px-2 text-left transition-colors hover:bg-surface-hover"
      : "agx-topbar-btn";

  const menu =
    userMenuOpen && menuPos && typeof document !== "undefined"
      ? createPortal(
          <div
            id="agx-account-identity-menu"
            className="z-[200] overflow-hidden rounded-xl bg-surface-base p-1.5 shadow-xl"
            style={{
              position: "fixed",
              top: menuPos.top,
              bottom: menuPos.bottom,
              left: menuPos.left,
              minWidth: menuPos.width,
            }}
          >
            {!agxAccount.loggedIn ? (
              <button
                type="button"
                className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover"
                onClick={() => void onLoginClick()}
                disabled={loginBusy}
              >
                <LogIn
                  className="h-[15px] w-[15px] shrink-0 text-text-muted group-hover:text-text-strong"
                  strokeWidth={2}
                />
                <span className="flex-1 text-[13px] font-medium leading-none text-text-strong">
                  {loginBusy ? t("identity.loggingIn") : t("identity.loginOfficial")}
                </span>
              </button>
            ) : null}
            <button
              type="button"
              className={`group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-surface-hover${agxAccount.loggedIn ? "" : " mt-0.5"}`}
              onClick={onViewAccount}
            >
              <User
                className="h-[15px] w-[15px] shrink-0 text-text-muted group-hover:text-text-strong"
                strokeWidth={2}
              />
              <span className="flex-1 text-[13px] font-medium leading-none text-text-strong">{t("identity.viewAccount")}</span>
            </button>
            {agxAccount.loggedIn ? (
              <button
                type="button"
                className="group mt-0.5 flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-rose-500/10"
                onClick={() => void onLogoutClick()}
              >
                <LogOut className="h-[15px] w-[15px] shrink-0 text-rose-400" strokeWidth={2} />
                <span className="flex-1 text-[13px] font-medium leading-none text-rose-400">{t("identity.logout")}</span>
              </button>
            ) : null}
          </div>,
          document.body
        )
      : null;

  return (
    <div ref={rootRef} className={`relative min-w-0 ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        onClick={onTriggerClick}
        disabled={loginBusy}
        aria-label={t("identity.menuAria")}
        aria-expanded={userMenuOpen}
      >
        {avatar}
        <span
          className={
            variant === "pill"
              ? "min-w-0 flex-1 truncate text-[13px] font-semibold text-text-strong"
              : "max-w-[120px] truncate text-[12px]"
          }
        >
          {label}
        </span>
      </button>
      {menu}
    </div>
  );
}
