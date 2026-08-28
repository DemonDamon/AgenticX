import { useEffect, useState, type ComponentType, type SVGAttributes } from "react";
import {
  Building2 as _Building2,
  LogIn as _LogIn,
  LogOut as _LogOut,
  Loader2 as _Loader2,
  User as _User,
} from "lucide-react";

import { Button } from "./ds/Button";
import { useAppStore } from "../store";

type IconProps = SVGAttributes<SVGSVGElement> & { className?: string };
function safeLucide(icon: ComponentType<IconProps> | undefined, fallbackLabel: string): ComponentType<IconProps> {
  if (typeof icon === "function" || (typeof icon === "object" && icon !== null)) return icon;
  return (props: IconProps) => <span {...props} aria-label={fallbackLabel} />;
}
const User = safeLucide(_User, "user");
const LogIn = safeLucide(_LogIn, "log-in");
const LogOut = safeLucide(_LogOut, "log-out");
const Loader2 = safeLucide(_Loader2, "loader");
const Building2 = safeLucide(_Building2, "building");

/**
 * 将官网 /init 错误转为「对用户的官方口径」：简短、不暴露部署细节；仅附错误码便于反馈支持。
 */
function formatAgxLoginInitError(raw: string): { message: string; detail?: string } {
  const code = (raw || "").trim();
  const supportTail = (id: string) => `错误代码 ${id}（向支持反馈时请一并提供）`;

  if (code === "database_not_configured") {
    return {
      message: "官网账号服务暂不可用，无法开始登录。请稍后再试；若多次出现，请联系 Near 支持。",
      detail: supportTail("AGX-AUTH-101"),
    };
  }
  if (code === "supabase_not_configured") {
    return {
      message: "账号系统暂不可用，无法开始登录。请稍后再试；若多次出现，请联系 Near 支持。",
      detail: supportTail("AGX-AUTH-102"),
    };
  }
  if (code.startsWith("init_http_")) {
    return {
      message: "网络或服务异常，无法开始登录。请检查网络后重试。",
      detail: supportTail("AGX-AUTH-103"),
    };
  }
  if (code === "database_schema_missing") {
    return {
      message: "账号服务尚未完成初始化，无法开始登录。请联系 Near 支持或稍后再试。",
      detail: supportTail("AGX-AUTH-105"),
    };
  }
  if (code === "database_connection_failed") {
    return {
      message: "无法连接到账号数据库，请稍后再试；若多次出现，请联系 Near 支持。",
      detail: supportTail("AGX-AUTH-106"),
    };
  }
  if (code === "database_ssl_error") {
    return {
      message: "与账号服务的安全连接异常，请稍后再试；若多次出现，请联系 Near 支持。",
      detail: supportTail("AGX-AUTH-107"),
    };
  }
  if (code === "database_auth_failed") {
    return {
      message: "账号数据库鉴权失败，服务暂不可用。请联系 Near 支持。",
      detail: supportTail("AGX-AUTH-108"),
    };
  }
  if (code === "server_error") {
    return {
      message: "服务暂时繁忙，无法开始登录。请稍后再试。",
      detail: supportTail("AGX-AUTH-104"),
    };
  }
  return {
    message: "无法开始官网账号登录。请稍后再试。",
    detail: code ? supportTail(`AGX-AUTH-199 · ${code}`) : supportTail("AGX-AUTH-199"),
  };
}

export function AccountTab() {
  // Global account state is hydrated in App.tsx; read here so Topbar and Settings stay in sync.
  const acct = useAppStore((s) => s.agxAccount);
  const setAgxAccount = useAppStore((s) => s.setAgxAccount);
  const [loginBusy, setLoginBusy] = useState(false);
  const [waitingBrowser, setWaitingBrowser] = useState(false);

  // 企业门户账号与官网账号相互独立：一个用于云房间等企业能力，一个用于 agxbuilder.com。
  // 状态只留在本组件，不进全局 store。
  const [entLoggedIn, setEntLoggedIn] = useState(false);
  const [entEmail, setEntEmail] = useState("");
  const [entDisplayName, setEntDisplayName] = useState("");
  const [entPortalUrl, setEntPortalUrl] = useState("");
  const [entBusy, setEntBusy] = useState(false);
  const [entWaiting, setEntWaiting] = useState(false);
  const [entVerifyUrl, setEntVerifyUrl] = useState("");
  const [entError, setEntError] = useState("");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const r = await window.agenticxDesktop.loadEnterpriseAccount();
        if (cancelled || !r.ok) return;
        setEntLoggedIn(Boolean(r.loggedIn));
        setEntEmail(String(r.email ?? ""));
        setEntDisplayName(String(r.displayName ?? ""));
        setEntPortalUrl(String(r.portalUrl ?? ""));
      } catch {
        // 企业账号是可选能力，读取失败不影响本地使用
      }
    })();

    const offChanged = window.agenticxDesktop.onEnterpriseAccountChanged((payload) => {
      setEntWaiting(false);
      setEntBusy(false);
      setEntVerifyUrl("");
      setEntError("");
      setEntLoggedIn(Boolean(payload.loggedIn));
      setEntEmail(String(payload.email ?? ""));
      setEntDisplayName(String(payload.displayName ?? ""));
      if (payload.portalUrl) setEntPortalUrl(String(payload.portalUrl));
    });
    const offFailed = window.agenticxDesktop.onEnterpriseLoginFailed((payload) => {
      setEntWaiting(false);
      setEntBusy(false);
      setEntVerifyUrl("");
      setEntError(String(payload.error || "企业登录未完成，请重试"));
    });
    const offTimeout = window.agenticxDesktop.onEnterpriseLoginTimeout(() => {
      setEntWaiting(false);
      setEntBusy(false);
      setEntVerifyUrl("");
      setEntError("等待授权超时，请重新发起登录");
    });
    return () => {
      cancelled = true;
      offChanged();
      offFailed();
      offTimeout();
    };
  }, []);

  useEffect(() => {
    // Clear local waiting state when account becomes logged-in (event fired from App.tsx listener).
    if (acct.loggedIn) {
      setWaitingBrowser(false);
      setLoginBusy(false);
    }
  }, [acct.loggedIn]);

  useEffect(() => {
    // Also clear waiting state on timeout; the user-facing dialog is shown in App.tsx.
    const offTimeout = window.agenticxDesktop.onAgxAccountLoginTimeout(() => {
      setWaitingBrowser(false);
      setLoginBusy(false);
    });
    return () => {
      offTimeout();
    };
  }, []);

  const onLogin = async () => {
    setLoginBusy(true);
    setWaitingBrowser(true);
    try {
      const r = await window.agenticxDesktop.agxAccountLoginStart();
      if (!r.ok) {
        setWaitingBrowser(false);
        const raw = typeof r.error === "string" ? r.error : "";
        const { message, detail } = formatAgxLoginInitError(raw);
        await window.agenticxDesktop.confirmDialog({
          title: "无法开始登录",
          message,
          detail,
          confirmText: "确定",
        });
      }
    } catch (e) {
      setWaitingBrowser(false);
      await window.agenticxDesktop.confirmDialog({
        title: "无法开始登录",
        message: String(e),
        confirmText: "确定",
      });
    } finally {
      setLoginBusy(false);
    }
  };

  const onCancelWait = async () => {
    await window.agenticxDesktop.agxAccountLoginCancel();
    setWaitingBrowser(false);
  };

  const onLogout = async () => {
    const r = await window.agenticxDesktop.confirmDialog({
      title: "退出官网账号",
      message: "确定要清除本机已保存的 Near 官网登录状态吗？",
      confirmText: "退出",
      destructive: true,
    });
    if (!r.confirmed) return;
    await window.agenticxDesktop.agxAccountLogout();
    setAgxAccount({ loggedIn: false, email: "", displayName: "" });
  };

  const onEnterpriseLogin = async () => {
    if (entBusy) return;
    setEntBusy(true);
    setEntError("");
    try {
      const r = await window.agenticxDesktop.enterpriseLoginStart({ portalUrl: entPortalUrl });
      if (!r.ok) {
        setEntError(r.error || "无法连接企业门户，请检查地址与网络");
        return;
      }
      setEntVerifyUrl(String(r.verification_url ?? ""));
      setEntWaiting(true);
    } catch (e) {
      setEntError(String(e));
    } finally {
      setEntBusy(false);
    }
  };

  const onEnterpriseCancel = async () => {
    await window.agenticxDesktop.enterpriseLoginCancel();
    setEntWaiting(false);
    setEntVerifyUrl("");
  };

  const onEnterpriseLogout = async () => {
    const r = await window.agenticxDesktop.confirmDialog({
      title: "退出企业账号",
      message: "确定要清除本机已保存的企业登录状态吗？退出后将无法访问云房间。",
      confirmText: "退出",
      destructive: true,
    });
    if (!r.confirmed) return;
    await window.agenticxDesktop.enterpriseLogout();
    setEntLoggedIn(false);
    setEntEmail("");
    setEntDisplayName("");
  };

  return (
    <div className="space-y-6 text-sm text-text-strong">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 items-center justify-center rounded-full bg-surface-card-strong text-text-strong">
          <User className="size-4" />
        </div>
        <div>
          <div className="text-[16px] font-semibold text-text-primary">Near 官网账号</div>
          <p className="mt-1 text-xs text-text-subtle leading-relaxed">
            与 <span className="font-mono text-[11px]">agxbuilder.com</span>{" "}
            使用同一套账号。点击登录后将在系统浏览器中完成验证，本应用自动同步登录状态。
            本功能依赖 Near 官网服务；若暂不可用，可能为服务维护或能力未开放，请稍后再试。
          </p>
        </div>
      </div>

      {acct.loggedIn ? (
        <div className="rounded-lg border border-border bg-surface-card px-4 py-3 space-y-2">
          <div className="text-xs text-text-subtle">当前已登录</div>
          <div className="font-medium">{acct.displayName || acct.email || "（无显示名）"}</div>
          {acct.email ? <div className="text-xs text-text-subtle font-mono">{acct.email}</div> : null}
          <Button
            type="button"
            variant="ghost"
            className="mt-2 inline-flex items-center gap-1.5 border border-border"
            onClick={() => void onLogout()}
          >
            <LogOut className="size-3.5" />
            退出登录
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface-card px-4 py-4 space-y-3">
          <p className="text-xs text-text-subtle">
            点击下方按钮将在系统浏览器中打开官网登录页；完成后本窗口会自动更新状态。
          </p>
          {waitingBrowser ? (
            <div className="flex flex-col gap-2 rounded-md bg-surface-hover px-3 py-3">
              <div className="flex items-center gap-2 text-xs text-text-subtle">
                <Loader2 className="size-4 animate-spin shrink-0" />
                等待浏览器登录完成…
              </div>
              <Button type="button" variant="ghost" className="text-xs py-1" onClick={() => void onCancelWait()}>
                取消等待
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              variant="primary"
              className="inline-flex items-center gap-2"
              disabled={loginBusy}
              onClick={() => void onLogin()}
            >
              {loginBusy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <LogIn className="size-4" />
              )}
              使用官网账号登录
            </Button>
          )}
        </div>
      )}

      <div className="border-t border-border pt-6">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 flex size-9 items-center justify-center rounded-full bg-surface-card-strong text-text-strong">
            <Building2 className="size-4" />
          </div>
          <div>
            <div className="text-[16px] font-semibold text-text-primary">企业账号</div>
            <p className="mt-1 text-xs text-text-subtle leading-relaxed">
              登录企业门户后，即可在「云房间」里与同事协作。点击登录将在系统浏览器中完成授权，
              授权通过后本窗口会自动更新状态。与上方官网账号相互独立。
            </p>
          </div>
        </div>

        {entLoggedIn ? (
          <div className="mt-4 rounded-lg border border-border bg-surface-card px-4 py-3 space-y-2">
            <div className="text-xs text-text-subtle">当前已登录</div>
            <div className="font-medium">{entDisplayName || entEmail || "（无显示名）"}</div>
            {entEmail ? <div className="text-xs text-text-subtle font-mono">{entEmail}</div> : null}
            {entPortalUrl ? (
              <div className="text-xs text-text-subtle font-mono">{entPortalUrl}</div>
            ) : null}
            <Button
              type="button"
              variant="ghost"
              className="mt-2 inline-flex items-center gap-1.5 border border-border"
              onClick={() => void onEnterpriseLogout()}
            >
              <LogOut className="size-3.5" />
              退出企业账号
            </Button>
          </div>
        ) : (
          <div className="mt-4 rounded-lg border border-border bg-surface-card px-4 py-4 space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs text-text-subtle">企业门户地址</span>
              <input
                type="text"
                className="w-full rounded-md border border-border bg-surface-base px-3 py-2 text-sm text-text-primary outline-none"
                value={entPortalUrl}
                placeholder="https://portal.example.com"
                disabled={entWaiting}
                onChange={(e) => setEntPortalUrl(e.target.value)}
              />
            </label>

            {entWaiting ? (
              <div className="flex flex-col gap-2 rounded-md bg-surface-hover px-3 py-3">
                <div className="flex items-center gap-2 text-xs text-text-subtle">
                  <Loader2 className="size-4 animate-spin shrink-0" />
                  等待浏览器中完成授权…
                </div>
                {entVerifyUrl ? (
                  <div className="text-xs text-text-subtle break-all">
                    没有自动打开？
                    <a className="underline" href={entVerifyUrl} target="_blank" rel="noreferrer">
                      {entVerifyUrl}
                    </a>
                  </div>
                ) : null}
                <Button
                  type="button"
                  variant="ghost"
                  className="text-xs py-1"
                  onClick={() => void onEnterpriseCancel()}
                >
                  取消等待
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="primary"
                className="inline-flex items-center gap-2"
                disabled={entBusy}
                onClick={() => void onEnterpriseLogin()}
              >
                {entBusy ? <Loader2 className="size-4 animate-spin" /> : <LogIn className="size-4" />}
                登录企业账号
              </Button>
            )}

            {entError ? <p className="text-xs text-amber-500">{entError}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}
