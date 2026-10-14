import { useEffect, useRef, useState, type ComponentType, type SVGAttributes } from "react";
import {
  Building2 as _Building2,
  LogIn as _LogIn,
  LogOut as _LogOut,
  Loader2 as _Loader2,
  User as _User,
} from "lucide-react";

import { useTranslation } from "react-i18next";
import { Button } from "./ds/Button";
import { useAppStore } from "../store";
import { i18n } from "../i18n/i18n";

type WorkerStatus = {
  enabled?: boolean;
  running?: boolean;
  agents?: Array<{ displayName?: string; slug?: string; id?: string }>;
  last_heartbeat_at?: string | null;
  last_error?: string | null;
};

function formatHeartbeat(value: string | null | undefined): string {
  if (!value) return "暂无";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

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
  const t = (key: string, opts?: Record<string, unknown>) =>
    String(i18n.t(key, { ns: "settings", ...opts }));
  const supportTail = (id: string) => t("account.supportTail", { id });

  if (code === "database_not_configured") {
    return { message: t("account.errDatabase"), detail: supportTail("AGX-AUTH-101") };
  }
  if (code === "supabase_not_configured") {
    return { message: t("account.errSupabase"), detail: supportTail("AGX-AUTH-102") };
  }
  if (code.startsWith("init_http_")) {
    return { message: t("account.errNetwork"), detail: supportTail("AGX-AUTH-103") };
  }
  if (code === "database_schema_missing") {
    return { message: t("account.errSchema"), detail: supportTail("AGX-AUTH-105") };
  }
  if (code === "database_connection_failed") {
    return { message: t("account.errDbConn"), detail: supportTail("AGX-AUTH-106") };
  }
  if (code === "database_ssl_error") {
    return { message: t("account.errSsl"), detail: supportTail("AGX-AUTH-107") };
  }
  if (code === "database_auth_failed") {
    return { message: t("account.errDbAuth"), detail: supportTail("AGX-AUTH-108") };
  }
  if (code === "server_error") {
    return { message: t("account.errBusy"), detail: supportTail("AGX-AUTH-104") };
  }
  return {
    message: t("account.errGeneric"),
    detail: code ? supportTail(`AGX-AUTH-199 · ${code}`) : supportTail("AGX-AUTH-199"),
  };
}

export function AccountTab() {
  const { t } = useTranslation("settings");
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
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const [workerEnabled, setWorkerEnabled] = useState(false);
  const [workerRunning, setWorkerRunning] = useState(false);
  const [workerAgents, setWorkerAgents] = useState<string[]>([]);
  const [workerHeartbeat, setWorkerHeartbeat] = useState("");
  const [workerLastError, setWorkerLastError] = useState("");
  const [workerToggleError, setWorkerToggleError] = useState("");
  const [workerBusy, setWorkerBusy] = useState(false);
  const workerSaveGen = useRef(0);

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
      setEntError(String(payload.error || i18n.t("account.entLoginIncomplete", { ns: "settings" })));
    });
    const offTimeout = window.agenticxDesktop.onEnterpriseLoginTimeout(() => {
      setEntWaiting(false);
      setEntBusy(false);
      setEntVerifyUrl("");
      setEntError(String(i18n.t("account.entAuthTimeout", { ns: "settings" })));
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
          title: t("account.cannotStartTitle"),
          message,
          detail,
          confirmText: t("account.ok"),
        });
      }
    } catch (e) {
      setWaitingBrowser(false);
      await window.agenticxDesktop.confirmDialog({
        title: t("account.cannotStartTitle"),
        message: String(e),
        confirmText: t("account.ok"),
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
      title: t("account.logoutOfficialTitle"),
      message: t("account.logoutOfficialMsg"),
      confirmText: t("account.logoutConfirm"),
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
        setEntError(r.error || t("account.entConnectFailed"));
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
      title: t("account.logoutEnterpriseTitle"),
      message: t("account.logoutEnterpriseMsg"),
      confirmText: t("account.logoutConfirm"),
      destructive: true,
    });
    if (!r.confirmed) return;
    await window.agenticxDesktop.enterpriseLogout();
    setEntLoggedIn(false);
    setEntEmail("");
    setEntDisplayName("");
  };

  useEffect(() => {
    if (!entLoggedIn) return;
    let cancelled = false;
    const timer = window.setInterval(() => {
      void refreshWorkerStatus();
    }, 10000);
    void refreshWorkerStatus();

    async function studioAuth(): Promise<{ base: string; headers: Record<string, string> } | null> {
      let base = String(apiBase ?? "").trim().replace(/\/$/, "");
      let token = String(apiToken ?? "").trim();
      if (!base) {
        try {
          base = String((await window.agenticxDesktop.getApiBase()) || "")
            .trim()
            .replace(/\/$/, "");
        } catch {
          base = "";
        }
      }
      if (!token) {
        try {
          token = String((await window.agenticxDesktop.getApiAuthToken()) || "").trim();
        } catch {
          token = "";
        }
      }
      if (!base) return null;
      const headers: Record<string, string> = {};
      if (token) headers["x-agx-desktop-token"] = token;
      return { base, headers };
    }

    function applyWorkerStatus(data: {
      enabled?: boolean;
      running?: boolean;
      agents?: Array<{ displayName?: string; slug?: string; id?: string }>;
      last_heartbeat_at?: string | null;
      last_error?: string | null;
    }) {
      setWorkerEnabled(Boolean(data.enabled));
      setWorkerRunning(Boolean(data.running));
      const names = (data.agents ?? [])
        .map((agent) => String(agent.displayName || agent.slug || agent.id || "").trim())
        .filter(Boolean);
      setWorkerAgents(names);
      setWorkerHeartbeat(formatHeartbeat(data.last_heartbeat_at));
      setWorkerLastError(String(data.last_error || ""));
    }

    async function refreshWorkerStatus() {
      const gen = workerSaveGen.current;
      const auth = await studioAuth();
      if (!auth || cancelled) return;
      try {
        const response = await fetch(`${auth.base}/api/enterprise-worker/status`, {
          headers: auth.headers,
        });
        if (!response.ok || cancelled || gen !== workerSaveGen.current) return;
        const data = (await response.json()) as {
          enabled?: boolean;
          running?: boolean;
          agents?: Array<{ displayName?: string; slug?: string; id?: string }>;
          last_heartbeat_at?: string | null;
          last_error?: string | null;
        };
        if (cancelled || gen !== workerSaveGen.current) return;
        applyWorkerStatus(data);
      } catch {
        // Keep the last visible status when a refresh fails.
      }
    }

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [entLoggedIn, apiBase, apiToken]);

  const onWorkerToggle = async (next: boolean) => {
    if (workerBusy) return;
    const previous = workerEnabled;
    const gen = workerSaveGen.current + 1;
    workerSaveGen.current = gen;
    setWorkerEnabled(next);
    setWorkerToggleError("");
    setWorkerBusy(true);
    try {
      let base = String(apiBase ?? "").trim().replace(/\/$/, "");
      let token = String(apiToken ?? "").trim();
      if (!base) {
        base = String((await window.agenticxDesktop.getApiBase()) || "")
          .trim()
          .replace(/\/$/, "");
      }
      if (!token) {
        token = String((await window.agenticxDesktop.getApiAuthToken()) || "").trim();
      }
      if (!base) throw new Error("保存失败");
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["x-agx-desktop-token"] = token;
      const response = await fetch(`${base}/api/enterprise-worker`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ enabled: next }),
      });
      if (!response.ok) throw new Error(`保存失败（${response.status}）`);
      const data = (await response.json()) as {
        enabled?: boolean;
        running?: boolean;
        last_error?: string | null;
      };
      if (gen !== workerSaveGen.current) return;
      setWorkerEnabled(Boolean(data.enabled));
      setWorkerRunning(Boolean(data.running));
      if (typeof data.last_error === "string") setWorkerLastError(data.last_error);
      if (next && data.enabled === false) {
        setWorkerToggleError("未能开启，请确认企业账号仍有效");
      }
    } catch (error) {
      if (gen !== workerSaveGen.current) return;
      setWorkerEnabled(previous);
      const message = error instanceof Error ? error.message : "保存失败";
      setWorkerToggleError(message || "保存失败");
    } finally {
      if (gen === workerSaveGen.current) setWorkerBusy(false);
    }
  };

  return (
    <div className="space-y-6 text-sm text-text-strong">
      <div className="flex items-start gap-3">
        <div className="mt-0.5 flex size-9 items-center justify-center rounded-full bg-surface-card-strong text-text-strong">
          <User className="size-4" />
        </div>
        <div>
          <div className="text-[16px] font-semibold text-text-primary">{t("account.officialTitle")}</div>
          <p className="mt-1 text-xs text-text-subtle leading-relaxed">{t("account.officialIntro")}</p>
        </div>
      </div>

      {acct.loggedIn ? (
        <div className="rounded-lg border border-border bg-surface-card px-4 py-3 space-y-2">
          <div className="text-xs text-text-subtle">{t("account.loggedIn")}</div>
          <div className="font-medium">{acct.displayName || acct.email || t("account.noDisplayName")}</div>
          {acct.email ? <div className="text-xs text-text-subtle font-mono">{acct.email}</div> : null}
          <Button
            type="button"
            variant="ghost"
            className="mt-2 inline-flex items-center gap-1.5 border border-border"
            onClick={() => void onLogout()}
          >
            <LogOut className="size-3.5" />
            {t("account.logoutOfficial")}
          </Button>
        </div>
      ) : (
        <div className="rounded-lg border border-border bg-surface-card px-4 py-4 space-y-3">
          <p className="text-xs text-text-subtle">
            {t("account.loginHint")}
          </p>
          {waitingBrowser ? (
            <div className="flex flex-col gap-2 rounded-md bg-surface-hover px-3 py-3">
              <div className="flex items-center gap-2 text-xs text-text-subtle">
                <Loader2 className="size-4 animate-spin shrink-0" />
                {t("account.waitingBrowser")}
              </div>
              <Button type="button" variant="ghost" className="text-xs py-1" onClick={() => void onCancelWait()}>
                {t("account.cancelWait")}
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
              {t("account.loginOfficial")}
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
            <div className="text-[16px] font-semibold text-text-primary">{t("account.enterpriseTitle")}</div>
            <p className="mt-1 text-xs text-text-subtle leading-relaxed">{t("account.enterpriseIntro")}</p>
          </div>
        </div>

        {entLoggedIn ? (
          <>
            <div className="mt-4 rounded-lg border border-border bg-surface-card px-4 py-3 space-y-2">
              <div className="text-xs text-text-subtle">{t("account.loggedIn")}</div>
              <div className="font-medium">{entDisplayName || entEmail || t("account.noDisplayName")}</div>
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
                {t("account.logoutEnterprise")}
              </Button>
            </div>
            <div className="mt-4 rounded-lg border border-border bg-surface-card px-4 py-3 space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium">让这台电脑承接企业智能体任务</div>
                  <p className="mt-1 text-xs text-text-subtle leading-relaxed">
                    开启后，房间里点名『员工桌面执行』类智能体的任务会在这台电脑上用本机模型执行
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-label="让这台电脑承接企业智能体任务"
                  aria-checked={workerEnabled}
                  disabled={workerBusy}
                  onClick={() => void onWorkerToggle(!workerEnabled)}
                  className={`relative mt-0.5 inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--settings-accent-focus,rgba(59,130,246,0.5))] ${
                    workerEnabled ? "bg-[var(--ui-btn-primary-bg)]" : "bg-surface-hover"
                  } ${workerBusy ? "opacity-50" : ""}`}
                >
                  <span
                    className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full shadow transition-transform ${
                      workerEnabled ? "translate-x-4 bg-[var(--ui-btn-primary-text)]" : "bg-white"
                    }`}
                  />
                </button>
              </div>
              <div className="space-y-1 text-xs text-text-subtle">
                <div>状态：{workerRunning ? "运行中" : "已停止"}</div>
                <div>可承接智能体：{workerAgents.length > 0 ? workerAgents.join("、") : "暂无"}</div>
                <div>最近心跳：{workerHeartbeat || "暂无"}</div>
                {workerLastError ? <div className="text-amber-500">最近错误：{workerLastError}</div> : null}
              </div>
              {workerToggleError ? <p className="text-xs text-amber-500">{workerToggleError}</p> : null}
            </div>
          </>
        ) : (
          <div className="mt-4 rounded-lg border border-border bg-surface-card px-4 py-4 space-y-3">
            <label className="block space-y-1.5">
              <span className="text-xs text-text-subtle">{t("account.portalUrl")}</span>
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
                  {t("account.waitingAuth")}
                </div>
                {entVerifyUrl ? (
                  <div className="text-xs text-text-subtle break-all">
                    {t("account.openManually")}
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
                  {t("account.cancelWait")}
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
                {t("account.loginEnterprise")}
              </Button>
            )}

            {entError ? <p className="text-xs text-amber-500">{entError}</p> : null}
          </div>
        )}
      </div>
    </div>
  );
}
