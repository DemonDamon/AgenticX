import { useCallback, useEffect, useState } from "react";
import { Building2, Eye, EyeOff, Loader2, LogOut, RefreshCw } from "lucide-react";

type EnterpriseState = {
  enabled: boolean;
  baseUrl: string;
  email: string;
  displayName: string;
  strict: boolean;
  models: string[];
  syncedAt: string;
};

const emptyState: EnterpriseState = {
  enabled: false,
  baseUrl: "",
  email: "",
  displayName: "",
  strict: true,
  models: [],
  syncedAt: "",
};

type Props = {
  onChanged?: () => void;
};

export function EnterpriseAccountPanel({ onChanged }: Props) {
  const [state, setState] = useState<EnterpriseState>(emptyState);
  const [baseUrl, setBaseUrl] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const r = await window.agenticxDesktop.loadEnterprise();
      const next: EnterpriseState = {
        enabled: Boolean(r.enabled),
        baseUrl: r.baseUrl ?? "",
        email: r.email ?? "",
        displayName: r.displayName ?? "",
        strict: r.strict !== false,
        models: r.models ?? [],
        syncedAt: r.syncedAt ?? "",
      };
      setState(next);
      if (!next.enabled) {
        setBaseUrl((prev) => prev || next.baseUrl);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleLogin = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await window.agenticxDesktop.enterpriseLogin({
        baseUrl: baseUrl.trim(),
        email: email.trim(),
        password,
      });
      if (!r.ok) {
        setError(r.error || "登录失败");
        return;
      }
      setPassword("");
      setShowPassword(false);
      await reload();
      onChanged?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleLogout = async () => {
    setError(null);
    setBusy(true);
    try {
      await window.agenticxDesktop.enterpriseLogout();
      await reload();
      onChanged?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRefresh = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await window.agenticxDesktop.enterpriseRefresh();
      if (!r.ok) {
        setError(r.error || "刷新失败");
        if (r.unauthorized) {
          setError("企业登录已失效，请重新登录");
        }
        return;
      }
      await reload();
      onChanged?.();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  const formIncomplete = !baseUrl.trim() || !email.trim() || !password;

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--settings-accent-row-bg)] text-[var(--settings-accent-fg)]">
          <Building2 className="h-5 w-5" aria-hidden />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text-primary">企业账号</h2>
          <p className="mt-0.5 text-xs text-text-subtle">
            使用企业分配的账号登录后，模型由管理员统一下发，无需自行配置 API Key。
          </p>
        </div>
      </div>

      {state.enabled ? (
        <div className="space-y-3 rounded-xl border border-border bg-surface-card p-4">
          <div className="text-sm text-text-primary">
            已登录：
            <span className="font-medium">
              {state.displayName || state.email || "企业用户"}
            </span>
          </div>
          <div className="text-xs text-text-subtle break-all">组织地址：{state.baseUrl}</div>
          <div className="text-xs text-text-subtle">
            可见模型 {state.models.length} 个
            {state.syncedAt ? ` · 同步于 ${state.syncedAt}` : ""}
          </div>
          {state.strict && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
              严格托管模式已开启：仅可使用企业模型，自配服务商已隐藏（退出登录后恢复）。
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleRefresh()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-panel px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
              刷新模型列表
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void handleLogout()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface-panel px-3 py-1.5 text-xs font-medium text-text-primary hover:bg-surface-hover disabled:opacity-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              退出企业登录
            </button>
          </div>
        </div>
      ) : (
        <div className="space-y-3 rounded-xl border border-border bg-surface-card p-4">
          <label className="block space-y-1">
            <span className="text-xs text-text-subtle">组织地址</span>
            <input
              className="w-full rounded-lg border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary outline-none focus:border-[var(--settings-accent-badge-bg)]"
              placeholder="https://portal.example.com"
              value={baseUrl}
              disabled={busy}
              onChange={(e) => setBaseUrl(e.target.value)}
              autoComplete="url"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-text-subtle">邮箱</span>
            <input
              className="w-full rounded-lg border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary outline-none focus:border-[var(--settings-accent-badge-bg)]"
              placeholder="name@example.com"
              value={email}
              disabled={busy}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-xs text-text-subtle">密码</span>
            <div className="relative">
              <input
                type={showPassword ? "text" : "password"}
                className="w-full rounded-lg border border-border bg-surface-panel py-2 pl-3 pr-11 text-sm text-text-primary outline-none focus:border-[var(--settings-accent-badge-bg)]"
                value={password}
                disabled={busy}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void handleLogin();
                  }
                }}
              />
              <button
                type="button"
                tabIndex={-1}
                disabled={busy}
                aria-label={showPassword ? "隐藏密码" : "显示密码"}
                className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text-subtle disabled:opacity-50"
                onClick={() => setShowPassword((v) => !v)}
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4 shrink-0" aria-hidden />
                ) : (
                  <Eye className="h-4 w-4 shrink-0" aria-hidden />
                )}
              </button>
            </div>
          </label>
          <button
            type="button"
            disabled={busy || formIncomplete}
            aria-busy={busy}
            onClick={() => void handleLogin()}
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium disabled:cursor-not-allowed ${
              formIncomplete && !busy ? "opacity-50" : ""
            }`}
            style={{
              background: "var(--ui-btn-primary-bg)",
              color: "var(--ui-btn-primary-text)",
            }}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
            {busy ? "登录中…" : "登录"}
          </button>
        </div>
      )}

      {error ? (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
          {error}
        </div>
      ) : null}
    </div>
  );
}
