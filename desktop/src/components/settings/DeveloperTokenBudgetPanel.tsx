import { useEffect, useState } from "react";
import {
  TOKEN_BUDGET_DEFAULT_SESSION,
  TOKEN_BUDGET_MAX_SESSION,
  TOKEN_BUDGET_WARNING_SESSION,
  normalizeSessionTokenLimit,
} from "../automation/TokenBudgetConfigSection";

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

export const DEVELOPER_TOKEN_BUDGET_MIN_SESSION = 500_000;

export function normalizeDeveloperSessionTokenLimit(raw: number): number {
  return Math.max(DEVELOPER_TOKEN_BUDGET_MIN_SESSION, normalizeSessionTokenLimit(raw));
}

export function DeveloperTokenBudgetPanel() {
  const [savedLimit, setSavedLimit] = useState(TOKEN_BUDGET_DEFAULT_SESSION);
  const [draftLimit, setDraftLimit] = useState(TOKEN_BUDGET_DEFAULT_SESSION);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        const limit = normalizeDeveloperSessionTokenLimit(
          Number(result.max_tokens_per_session ?? TOKEN_BUDGET_DEFAULT_SESSION),
        );
        setSavedLimit(limit);
        setDraftLimit(limit);
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

  const normalizedDraft = normalizeDeveloperSessionTokenLimit(draftLimit);
  const dirty = normalizedDraft !== savedLimit;

  const save = async () => {
    setSaving(true);
    setMessage("");
    try {
      const result = await window.agenticxDesktop.saveRuntimeConfig({
        max_tokens_per_session: normalizedDraft,
      });
      if (!result.ok) {
        setMessage(result.error || "保存失败");
        return;
      }
      setSavedLimit(normalizedDraft);
      setDraftLimit(normalizedDraft);
      setMessage("已保存；后续对话轮次生效");
    } catch (error) {
      setMessage(`保存失败：${String(error)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="text-sm font-semibold text-text-strong">会话资源限制</div>
      <p className="mt-1 text-xs leading-5 text-text-faint">
        单个对话累计达到 {formatTokenCount(TOKEN_BUDGET_WARNING_SESSION)} token 时开始提醒；达到上限的当前轮仍会完成，从下一轮开始停止。
      </p>

      <label className="mt-3 block text-xs text-text-muted">
        单对话 token 上限
        <input
          type="number"
          min={DEVELOPER_TOKEN_BUDGET_MIN_SESSION}
          max={TOKEN_BUDGET_MAX_SESSION}
          step={50_000}
          value={draftLimit}
          disabled={loading || saving}
          onChange={(event) => setDraftLimit(Number(event.target.value))}
          onBlur={() => setDraftLimit(normalizedDraft)}
          className="mt-1 w-full rounded-md border border-border bg-surface-panel px-2.5 py-2 text-sm text-text-primary disabled:opacity-50"
        />
      </label>
      <p className="mt-1 text-[11px] leading-5 text-text-faint">
        默认 {formatTokenCount(TOKEN_BUDGET_DEFAULT_SESSION)} token，可设置范围为 {formatTokenCount(DEVELOPER_TOKEN_BUDGET_MIN_SESSION)}–{formatTokenCount(TOKEN_BUDGET_MAX_SESSION)}。
      </p>

      <div className="mt-3 flex items-center gap-2">
        <button
          type="button"
          disabled={loading || saving || !dirty}
          onClick={() => void save()}
          className="rounded-md bg-btnPrimary px-3 py-1.5 text-xs font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? "保存中…" : "保存限制"}
        </button>
        {message ? (
          <span className={`text-xs ${message.startsWith("已保存") ? "text-text-muted" : "text-rose-400"}`}>
            {message}
          </span>
        ) : null}
      </div>
    </section>
  );
}
