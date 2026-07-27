import { useCallback, useEffect, useState } from "react";
import { Building2, Loader2, LogIn, LogOut, RefreshCw, User } from "lucide-react";

import { useAppStore } from "../store";

type Props = {
  onChanged?: () => void;
};

type EnterpriseExtras = {
  models: string[];
  syncedAt: string;
  strict: boolean;
  reauthRequiredForDirect: boolean;
  inferenceBaseUrl: string;
  transport: string;
};

const emptyExtras: EnterpriseExtras = {
  models: [],
  syncedAt: "",
  strict: true,
  reauthRequiredForDirect: false,
  inferenceBaseUrl: "",
  transport: "",
};

export function AccountTab({ onChanged }: Props) {
  const acct = useAppStore((s) => s.userAccount);
  const setUserAccount = useAppStore((s) => s.setUserAccount);
  const [baseUrl, setBaseUrl] = useState("");
  const [hasDefaultOrg, setHasDefaultOrg] = useState(false);
  const [showOrgEditor, setShowOrgEditor] = useState(false);
  const [extras, setExtras] = useState<EnterpriseExtras>(emptyExtras);
  const [loginBusy, setLoginBusy] = useState(false);
  const [waitingBrowser, setWaitingBrowser] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await window.agenticxDesktop.loadUserAccount();
      if (!r.ok) return;
      const loggedIn = Boolean(r.loggedIn);
      const defaultBaseUrl = String(r.defaultBaseUrl ?? r.baseUrl ?? "").trim();
      const resolvedBase = String(r.baseUrl ?? defaultBaseUrl).trim();
      setUserAccount({
        loggedIn,
        email: String(r.email ?? ""),
        displayName: String(r.displayName ?? ""),
        baseUrl: resolvedBase,
      });
      if (!loggedIn) {
        setBaseUrl((prev) => prev || resolvedBase);
        setHasDefaultOrg(Boolean(defaultBaseUrl));
        // Only ask employees for org URL when nothing is preconfigured.
        setShowOrgEditor(!defaultBaseUrl);
      }
      setExtras({
        models: Array.isArray(r.models) ? r.models.map(String) : [],
        syncedAt: String(r.syncedAt ?? ""),
        strict: r.strict !== false,
        reauthRequiredForDirect: Boolean(r.reauthRequiredForDirect),
        inferenceBaseUrl: String(r.inferenceBaseUrl ?? ""),
        transport: String(r.transport ?? ""),
      });
    } catch {
      /* ignore */
    }
  }, [setUserAccount]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    if (acct.loggedIn) {
      setWaitingBrowser(false);
      setLoginBusy(false);
      void reload();
      onChanged?.();
    }
  }, [acct.loggedIn, onChanged, reload]);

  useEffect(() => {
    const offTimeout = window.agenticxDesktop.onUserAccountLoginTimeout(() => {
      setWaitingBrowser(false);
      setLoginBusy(false);
      setError("未在有效时间内完成企业登录确认，请重试。");
    });
    return () => {
      offTimeout();
    };
  }, []);

  const onLogin = async () => {
    setError(null);
    setLoginBusy(true);
    setWaitingBrowser(true);
    try {
      const r = await window.agenticxDesktop.userAccountLoginStart({
        // Empty string → main process uses remembered / env default portal.
        baseUrl: showOrgEditor ? baseUrl.trim() : baseUrl.trim() || "",
      });
      if (!r.ok) {
        setWaitingBrowser(false);
        setError(typeof r.error === "string" && r.error ? r.error : "无法开始企业登录");
        if (!hasDefaultOrg) setShowOrgEditor(true);
      }
    } catch (e) {
      setWaitingBrowser(false);
      setError(String(e));
    } finally {
      setLoginBusy(false);
    }
  };

  const onCancelWait = async () => {
    await window.agenticxDesktop.userAccountLoginCancel();
    setWaitingBrowser(false);
    setLoginBusy(false);
  };

  const onLogout = async () => {
    setError(null);
    const r = await window.agenticxDesktop.confirmDialog({
      title: "退出用户账号",
      message: "确定要清除本机已保存的登录状态吗？退出后将恢复本地模型配置。",
      confirmText: "退出",
      destructive: true,
    });
    if (!r.confirmed) return;
    await window.agenticxDesktop.userAccountLogout();
    setUserAccount({ loggedIn: false, email: "", displayName: "", baseUrl: baseUrl });
    setExtras(emptyExtras);
    await reload();
    onChanged?.();
  };

  const onRefresh = async () => {
    setError(null);
    setLoginBusy(true);
    try {
      const r = await window.agenticxDesktop.enterpriseRefresh();
      if (!r.ok) {
        setError(r.unauthorized ? "企业登录已失效，请重新登录" : r.error || "刷新失败");
        return;
      }
      await reload();
      onChanged?.();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoginBusy(false);
    }
  };

  const loginDisabled = loginBusy || (showOrgEditor && !baseUrl.trim() && !hasDefaultOrg);

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--settings-accent-row-bg)] text-[var(--settings-accent-fg)]">
          <Building2 className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <div className="text-[16px] font-semibold text-text-primary">用户账号</div>
          <p className="mt-0.5 text-xs text-text-subtle leading-relaxed">
            使用企业账号登录后，模型由管理员统一下发，无需自行配置 API Key。点击登录将在系统浏览器打开企业门户。
          </p>
        </div>
      </div>

      {acct.loggedIn ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface-card p-4">
          <div className="flex items-center gap-2 text-sm text-text-primary">
            <User className="h-4 w-4 text-text-subtle" />
            当前已登录：
            <span className="font-medium">{acct.displayName || acct.email || "企业用户"}</span>
          </div>
          {acct.email ? <div className="text-xs text-text-subtle break-all">{acct.email}</div> : null}
          <div className="text-xs text-text-subtle">
            可见模型 {extras.models.length} 个
            {extras.syncedAt ? ` · 同步于 ${extras.syncedAt}` : ""}
          </div>
          {extras.strict && (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--status-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)] px-3 py-2 text-xs font-medium leading-relaxed text-[var(--status-warning)]">
              严格托管模式已开启：仅可使用企业模型，自配服务商已隐藏（退出登录后恢复）。
            </div>
          )}
          {extras.reauthRequiredForDirect && (
            <div className="rounded-lg border border-[color-mix(in_srgb,var(--status-warning)_40%,transparent)] bg-[color-mix(in_srgb,var(--status-warning)_12%,transparent)] px-3 py-2 text-xs font-medium leading-relaxed text-[var(--status-warning)]">
              重新登录后启用直连通道（当前仍走组织代理）。
            </div>
          )}
          {error ? <div className="text-xs text-rose-400">{error}</div> : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-1.5 text-xs font-medium text-text-muted transition hover:bg-surface-hover disabled:opacity-50"
              disabled={loginBusy}
              onClick={() => void onRefresh()}
            >
              {loginBusy ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              刷新模型列表
            </button>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 rounded-md bg-btnPrimary px-4 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-50"
              disabled={loginBusy}
              onClick={() => void onLogout()}
            >
              <LogOut className="h-3 w-3" />
              退出登录
            </button>
          </div>
        </div>
      ) : waitingBrowser ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface-card p-4">
          <div className="text-sm text-text-primary">
            已在系统浏览器打开企业门户。完成登录并确认授权后，应用会自动同步状态。
          </div>
          <div className="flex items-center gap-2 text-xs text-text-subtle">
            <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
            等待浏览器登录完成…
          </div>
          {error ? <div className="text-xs text-rose-400">{error}</div> : null}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-4 py-1.5 text-xs font-medium text-text-muted transition hover:bg-surface-hover"
            onClick={() => void onCancelWait()}
          >
            取消等待
          </button>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-surface-card p-4">
          {showOrgEditor ? (
            <label className="block space-y-1">
              <span className="text-xs text-text-subtle">组织地址</span>
              <input
                className="w-full rounded-lg border border-border bg-surface-panel px-3 py-2 text-[13px] text-text-primary outline-none focus:border-[var(--settings-accent-badge-bg)]"
                placeholder="由管理员提供，例如 https://portal.example.com"
                value={baseUrl}
                disabled={loginBusy}
                onChange={(e) => setBaseUrl(e.target.value)}
                autoComplete="url"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void onLogin();
                  }
                }}
              />
              {hasDefaultOrg ? (
                <button
                  type="button"
                  className="mt-1 text-xs text-text-subtle underline-offset-2 hover:text-text-primary hover:underline"
                  onClick={() => setShowOrgEditor(false)}
                >
                  使用已配置的组织
                </button>
              ) : null}
            </label>
          ) : (
            <p className="text-xs leading-relaxed text-text-subtle">
              点击下方按钮，在浏览器中使用企业账号完成登录即可。
              {hasDefaultOrg ? (
                <button
                  type="button"
                  className="ml-1 text-xs text-text-faint underline-offset-2 hover:text-text-subtle hover:underline"
                  onClick={() => setShowOrgEditor(true)}
                >
                  更换组织地址
                </button>
              ) : null}
            </p>
          )}
          {error ? <div className="text-xs text-rose-400">{error}</div> : null}
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md bg-btnPrimary px-4 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:opacity-50"
            disabled={loginDisabled}
            onClick={() => void onLogin()}
          >
            {loginBusy ? (
              <Loader2 className="h-3 w-3 shrink-0 animate-spin" />
            ) : (
              <LogIn className="h-3 w-3 shrink-0" />
            )}
            在浏览器中登录
          </button>
        </div>
      )}
    </div>
  );
}
