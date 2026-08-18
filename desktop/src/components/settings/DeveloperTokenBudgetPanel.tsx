import { useEffect, useState } from "react";
import {
  TOKEN_BUDGET_DEFAULT_SESSION,
  TOKEN_BUDGET_MAX_SESSION,
  TOKEN_BUDGET_MIN_SESSION,
  TOKEN_BUDGET_MIN_WARNING_SESSION,
  TOKEN_BUDGET_WARNING_SESSION,
  normalizeSessionWarningTokenLimit,
} from "../automation/TokenBudgetConfigSection";

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export const DEVELOPER_TOKEN_BUDGET_MIN_SESSION = TOKEN_BUDGET_MIN_SESSION;

export type DeveloperTokenBudgetValue = {
  warning: number;
  hard: number;
};

export function normalizeLoadedDeveloperTokenBudget(raw: {
  warning_tokens_per_session?: unknown;
  max_tokens_per_session?: unknown;
}): DeveloperTokenBudgetValue {
  const rawWarning = Number(raw.warning_tokens_per_session);
  const hasWarning =
    raw.warning_tokens_per_session !== undefined
    && raw.warning_tokens_per_session !== null
    && Number.isFinite(rawWarning);
  const rawHard = Number(raw.max_tokens_per_session);
  const hard = Number.isFinite(rawHard)
    ? Math.max(
        TOKEN_BUDGET_MIN_SESSION,
        Math.min(
          TOKEN_BUDGET_MAX_SESSION,
          Math.round(rawHard),
        ),
      )
    : TOKEN_BUDGET_DEFAULT_SESSION;
  return {
    warning: normalizeSessionWarningTokenLimit(
      hasWarning ? rawWarning : TOKEN_BUDGET_WARNING_SESSION,
      hard,
    ),
    hard,
  };
}

export function validateDeveloperTokenBudget(value: DeveloperTokenBudgetValue): string {
  if (!Number.isFinite(value.warning)) return "提醒阈值必须是数字";
  if (!Number.isFinite(value.hard)) return "停止阈值必须是数字";
  if (
    value.warning < TOKEN_BUDGET_MIN_WARNING_SESSION
    || value.warning >= TOKEN_BUDGET_MAX_SESSION
  ) {
    return `提醒阈值须在 ${formatTokenCount(TOKEN_BUDGET_MIN_WARNING_SESSION)}–${formatTokenCount(TOKEN_BUDGET_MAX_SESSION - 1)} 之间`;
  }
  if (value.hard < DEVELOPER_TOKEN_BUDGET_MIN_SESSION || value.hard > TOKEN_BUDGET_MAX_SESSION) {
    return `停止阈值须在 ${formatTokenCount(DEVELOPER_TOKEN_BUDGET_MIN_SESSION)}–${formatTokenCount(TOKEN_BUDGET_MAX_SESSION)} 之间`;
  }
  if (value.warning >= value.hard) return "提醒阈值必须低于停止阈值";
  return "";
}

export function DeveloperTokenBudgetPanel() {
  const defaults = normalizeLoadedDeveloperTokenBudget({});
  const [saved, setSaved] = useState<DeveloperTokenBudgetValue>(defaults);
  const [draft, setDraft] = useState<DeveloperTokenBudgetValue>(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [managed, setManaged] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    void window.agenticxDesktop
      .loadRuntimeConfig()
      .then((result) => {
        if (cancelled) return;
        if (!result.ok) {
          setMessage(result.error || "读取会话资源限制失败");
          return;
        }
        const loaded = normalizeLoadedDeveloperTokenBudget(result);
        setManaged(result.token_budget_managed === true);
        setSaved(loaded);
        setDraft(loaded);
      })
      .catch((error) => {
        if (!cancelled) setMessage(`读取会话资源限制失败：${String(error)}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const roundedDraft = {
    warning: Math.round(draft.warning),
    hard: Math.round(draft.hard),
  };
  const validationError = validateDeveloperTokenBudget(roundedDraft);
  const dirty = roundedDraft.warning !== saved.warning || roundedDraft.hard !== saved.hard;

  const save = async () => {
    if (managed) return;
    setSaving(true);
    setMessage("");
    try {
      const result = await window.agenticxDesktop.saveRuntimeConfig({
        warning_tokens_per_session: roundedDraft.warning,
        max_tokens_per_session: roundedDraft.hard,
      });
      if (!result.ok) {
        setMessage(result.error || "保存失败");
        return;
      }
      setSaved(roundedDraft);
      setDraft(roundedDraft);
      setMessage("已保存；后续对话轮次生效");
    } catch (error) {
      setMessage(`保存失败：${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface-card p-4">
      <div className="text-sm font-semibold text-text-strong">会话 Token 限制</div>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        达到提醒阈值时提示；达到停止阈值的当前轮会完成，下一轮停止。默认提醒 {formatTokenCount(TOKEN_BUDGET_WARNING_SESSION)}，默认停止 {formatTokenCount(TOKEN_BUDGET_DEFAULT_SESSION)}。
      </p>
      {managed ? (
        <p className="mt-2 text-xs leading-5 text-text-faint">
          当前数值由组织统一管理，登录企业账号期间不可在本机修改。
        </p>
      ) : null}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="block text-xs font-medium text-text-muted">
          提醒阈值
          <input
            aria-label="会话 Token 提醒阈值"
            type="number"
            min={TOKEN_BUDGET_MIN_WARNING_SESSION}
            max={TOKEN_BUDGET_MAX_SESSION - 1}
            step={50_000}
            value={draft.warning}
            disabled={loading || saving || managed}
            onChange={(event) => {
              setMessage("");
              setDraft((current) => ({
                ...current,
                warning: Math.round(Number(event.target.value)),
              }));
            }}
            className="mt-1.5 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm font-normal text-text-primary disabled:opacity-50"
          />
        </label>
        <label className="block text-xs font-medium text-text-muted">
          停止阈值
          <input
            aria-label="会话 Token 停止阈值"
            type="number"
            min={DEVELOPER_TOKEN_BUDGET_MIN_SESSION}
            max={TOKEN_BUDGET_MAX_SESSION}
            step={50_000}
            value={draft.hard}
            disabled={loading || saving || managed}
            onChange={(event) => {
              setMessage("");
              setDraft((current) => ({
                ...current,
                hard: Math.round(Number(event.target.value)),
              }));
            }}
            className="mt-1.5 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm font-normal text-text-primary disabled:opacity-50"
          />
        </label>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={loading || saving || managed || !dirty || Boolean(validationError)}
          onClick={() => void save()}
          className="rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {managed ? "组织统一管理" : saving ? "保存中…" : "保存限制"}
        </button>
        {validationError || message ? (
          <span className={`text-xs ${!validationError && message.startsWith("已保存") ? "text-text-muted" : "text-rose-400"}`}>
            {validationError || message}
          </span>
        ) : null}
      </div>
    </section>
  );
}
