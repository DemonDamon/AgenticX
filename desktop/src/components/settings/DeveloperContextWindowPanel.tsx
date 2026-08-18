import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../../store";
import { collectSelectableModelOptions } from "../../utils/model-options";
import { resolveManagedContextWindow } from "../../utils/managed-context-window";

/** 与主进程 sanitizeModelContextWindowOverrides 保持一致；主进程才是最终把关方。 */
export const MODEL_CONTEXT_WINDOW_MIN = 4_000;
export const MODEL_CONTEXT_WINDOW_MAX = 10_000_000;

export function modelContextWindowKey(provider: string, model: string): string {
  const p = String(provider ?? "").trim();
  const m = String(model ?? "").trim();
  if (!p || !m) return "";
  return `${p}/${m}`;
}

function formatTokenCount(value: number): string {
  return new Intl.NumberFormat("zh-CN").format(value);
}

/**
 * 校验一行输入。空串表示删除覆盖（回到自动识别），不是错误。
 * 返回 `{ error }` 时不提交，避免把猜高的值写进配置 —— 猜高会让压缩
 * 触发得太晚，直接撞上游的 context length 400。
 */
export function validateContextWindowInput(
  raw: string,
): { cleared: true } | { value: number } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { cleared: true };
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { error: "上下文窗口必须是数字" };
  const rounded = Math.floor(parsed);
  if (rounded < MODEL_CONTEXT_WINDOW_MIN || rounded > MODEL_CONTEXT_WINDOW_MAX) {
    return {
      error: `上下文窗口须在 ${formatTokenCount(MODEL_CONTEXT_WINDOW_MIN)}–${formatTokenCount(MODEL_CONTEXT_WINDOW_MAX)} 之间`,
    };
  }
  return { value: rounded };
}

export function DeveloperContextWindowPanel() {
  const providers = useAppStore((s) => s.settings.providers);
  const [saved, setSaved] = useState<Record<string, number>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
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
          setMessage(result.error || "读取模型上下文窗口失败");
          return;
        }
        setSaved(result.model_context_windows ?? {});
      })
      .catch((error) => {
        if (!cancelled) setMessage(`读取模型上下文窗口失败：${String(error)}`);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    return collectSelectableModelOptions(providers)
      .map((option) => ({
        ...option,
        key: modelContextWindowKey(option.provider, option.model),
        // 企业目录已声明的模型由组织统一管理，本机不改。
        managedWindow: resolveManagedContextWindow(providers, option.provider, option.model),
      }))
      .filter((row) => row.key);
  }, [providers]);

  const commit = async (key: string, raw: string) => {
    const clearDraft = () =>
      setDrafts((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });

    const parsed = validateContextWindowInput(raw);
    if ("error" in parsed) {
      setMessage(parsed.error);
      clearDraft();
      return;
    }
    const next = { ...saved };
    if ("cleared" in parsed) delete next[key];
    else next[key] = parsed.value;
    if (next[key] === saved[key]) {
      clearDraft();
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const result = await window.agenticxDesktop.saveRuntimeConfig({
        model_context_windows: next,
      });
      if (!result.ok) {
        setMessage(result.error || "保存失败");
        clearDraft();
        return;
      }
      setSaved(next);
      clearDraft();
      setMessage("cleared" in parsed ? "已恢复为自动识别；下一轮对话生效" : "已保存；下一轮对话生效");
    } catch (error) {
      setMessage(`保存失败：${String(error)}`);
      clearDraft();
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="rounded-xl border border-border bg-surface-card p-4">
      <div className="text-sm font-semibold text-text-strong">模型上下文窗口</div>
      <p className="mt-1 text-xs leading-5 text-text-muted">
        留空时按模型名自动识别。自部署端点的实际窗口由 vLLM 的 --max-model-len 等参数决定，
        常远低于模型架构支持的上限；填低了只是提前整理上下文，填高了会让整理触发得太晚、
        直接被上游拒绝，所以拿不准时宁可填小。
      </p>
      <p className="mt-2 text-xs leading-5 text-text-faint">
        企业模型的窗口由管理员在后台统一配置，这里只显示不可修改。
      </p>

      {loading ? (
        <p className="mt-3 text-xs text-text-muted">加载中…</p>
      ) : rows.length === 0 ? (
        <p className="mt-3 text-xs text-text-muted">尚未配置任何可用模型。</p>
      ) : (
        <ul className="mt-3 max-h-[320px] divide-y divide-border overflow-y-auto pr-1">
          {rows.map((row) => {
            const isManaged = row.managedWindow !== undefined;
            const value = isManaged
              ? String(row.managedWindow)
              : (drafts[row.key] ?? (saved[row.key] ? String(saved[row.key]) : ""));
            return (
              <li key={row.key} className="grid grid-cols-[minmax(0,1fr)_140px] items-center gap-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-xs font-medium text-text-primary">{row.label}</div>
                  <div className="truncate font-mono text-[11px] text-text-faint">{row.key}</div>
                </div>
                <input
                  aria-label={`${row.label} 上下文窗口`}
                  type="number"
                  min={MODEL_CONTEXT_WINDOW_MIN}
                  max={MODEL_CONTEXT_WINDOW_MAX}
                  step={1000}
                  placeholder={isManaged ? "组织统一管理" : "自动"}
                  value={value}
                  disabled={saving || isManaged}
                  onChange={(event) => {
                    setMessage("");
                    setDrafts((current) => ({ ...current, [row.key]: event.target.value }));
                  }}
                  onBlur={(event) => {
                    if (isManaged) return;
                    void commit(row.key, event.target.value);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                  }}
                  className="w-full rounded-md border border-border bg-surface-panel px-3 py-1.5 text-right font-mono text-xs text-text-primary disabled:opacity-50"
                />
              </li>
            );
          })}
        </ul>
      )}

      {message ? <p className="mt-3 text-xs text-text-muted">{message}</p> : null}
    </section>
  );
}
