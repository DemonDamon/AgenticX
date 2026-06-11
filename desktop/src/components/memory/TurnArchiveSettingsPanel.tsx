import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Panel } from "../ds/Panel";

type TurnArchiveForm = {
  enabled: boolean;
  min_chunk_chars: number;
  max_chunks_per_turn: number;
  recall_turns_limit: number;
  halflife_days: number;
};

const DEFAULTS: TurnArchiveForm = {
  enabled: false,
  min_chunk_chars: 40,
  max_chunks_per_turn: 3,
  recall_turns_limit: 3,
  halflife_days: 7,
};

function MiniSwitch({
  checked,
  disabled,
  onChange,
  "aria-label": ariaLabel,
}: {
  checked: boolean;
  disabled?: boolean;
  onChange: (next: boolean) => void;
  "aria-label"?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => {
        if (!disabled) onChange(!checked);
      }}
      className={`relative h-5 w-9 shrink-0 rounded-full transition focus:outline-none disabled:opacity-40 ${
        checked ? "bg-[rgb(var(--theme-color-rgb,16,185,129))]" : "bg-surface-hover"
      }`}
    >
      <span
        className={`pointer-events-none absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
          checked ? "translate-x-4" : "translate-x-0"
        }`}
      />
    </button>
  );
}

// Subtle numeric field: border appears on hover/focus only. Matches airy "composer-style" settings rows.
const TA_NUM_INPUT =
  "h-7 shrink-0 rounded border border-transparent bg-surface-hover/50 px-1.5 text-center text-xs tabular-nums text-text-primary outline-none transition hover:bg-surface-hover focus:border-[var(--settings-accent-focus)] focus:bg-surface-panel disabled:cursor-not-allowed disabled:opacity-40 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none";

function SettingNumberRow({
  label,
  hint,
  input,
}: {
  label: string;
  hint: string;
  input: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="min-w-0 flex-1">
        <div>{label}</div>
        <div className="mt-0.5 text-[11px] leading-relaxed text-text-faint">{hint}</div>
      </div>
      {input}
    </div>
  );
}

export function TurnArchiveSettingsPanel() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<TurnArchiveForm>({ ...DEFAULTS });
  const [lastSaved, setLastSaved] = useState<TurnArchiveForm>({ ...DEFAULTS });
  const [message, setMessage] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setMessage("");
      try {
        const result = await window.agenticxDesktop.loadTurnArchiveConfig();
        if (!disposed && result?.ok && result.config) {
          const loaded: TurnArchiveForm = {
            enabled: Boolean(result.config.enabled),
            min_chunk_chars:
              Number(result.config.min_chunk_chars) > 0
                ? Number(result.config.min_chunk_chars)
                : DEFAULTS.min_chunk_chars,
            max_chunks_per_turn:
              Number(result.config.max_chunks_per_turn) > 0
                ? Number(result.config.max_chunks_per_turn)
                : DEFAULTS.max_chunks_per_turn,
            recall_turns_limit:
              Number(result.config.recall_turns_limit) > 0
                ? Number(result.config.recall_turns_limit)
                : DEFAULTS.recall_turns_limit,
            halflife_days:
              Number(result.config.halflife_days) > 0
                ? Number(result.config.halflife_days)
                : DEFAULTS.halflife_days,
          };
          setForm(loaded);
          setLastSaved(loaded);
        } else if (!disposed) {
          setMessage(result?.error ? String(result.error) : "读取配置失败。");
        }
      } catch {
        if (!disposed) setMessage("读取配置失败。");
      } finally {
        if (!disposed) setLoading(false);
      }
    };
    void load();
    return () => {
      disposed = true;
    };
  }, []);

  const save = useCallback(
    async (patch: Partial<TurnArchiveForm>) => {
      const next = { ...form, ...patch };
      setForm(next);
      setSaving(true);
      setMessage("");
      try {
        const result = await window.agenticxDesktop.saveTurnArchiveConfig(next);
        if (!result?.ok) {
          setForm(lastSaved);
          setMessage(result?.error ? String(result.error) : "保存失败。");
          return;
        }
        setLastSaved(next);
        setMessage("已保存。归档开关需新开对话后生效；召回参数下轮对话即生效。");
      } catch (e) {
        setForm(lastSaved);
        setMessage(e instanceof Error ? e.message : "保存失败。");
      } finally {
        setSaving(false);
      }
    },
    [form, lastSaved],
  );

  if (loading) {
    return (
      <Panel title="对话轮次记忆">
        <div className="py-2 text-sm text-text-faint">加载中…</div>
      </Panel>
    );
  }

  return (
    <Panel title="对话轮次记忆" collapsible defaultCollapsed>
      <p className="mb-3 text-[11px] leading-relaxed text-text-faint">
        每轮对话结束后将 user/assistant 语义块写入本地记忆库，并在后续对话中按「相关度 × 新近度 × 访问强化」复合排序召回。
        与 MEMORY.md 长期记忆、记忆图谱并行，不互相替换。写入{" "}
        <code className="text-text-subtle">~/.agenticx/config.yaml</code> 的{" "}
        <code className="text-text-subtle">memory.turn_archive</code>。
      </p>
      <div className="space-y-0 text-sm text-text-subtle">
        {/* Enable row — no trailing divider for a lighter look */}
        <div className="flex items-center justify-between gap-4 py-2">
          <div className="min-w-0 flex-1">
            <div>启用对话轮次归档</div>
            <div className="mt-0.5 text-[11px] leading-relaxed text-text-faint">
              默认关闭；开启后每轮结束异步写入 turns 索引
            </div>
          </div>
          <MiniSwitch
            checked={form.enabled}
            disabled={saving}
            onChange={(next) => void save({ enabled: next })}
            aria-label="启用对话轮次归档"
          />
        </div>

        {/* Main params — airy, no per-row lines (matching clean composer-style settings) */}
        <SettingNumberRow
          label="召回条数上限"
          hint="每轮注入系统提示的历史对话片段数"
          input={
            <input
              type="number"
              min={1}
              max={10}
              disabled={saving || !form.enabled}
              value={form.recall_turns_limit}
              onChange={(e) => setForm((prev) => ({ ...prev, recall_turns_limit: Number(e.target.value) }))}
              onBlur={() => {
                const v = Math.max(
                  1,
                  Math.min(10, Math.round(form.recall_turns_limit) || DEFAULTS.recall_turns_limit),
                );
                if (v !== form.recall_turns_limit) void save({ recall_turns_limit: v });
                else if (v !== lastSaved.recall_turns_limit) void save({ recall_turns_limit: v });
              }}
              className={`${TA_NUM_INPUT} w-[3.25rem]`}
              aria-label="召回条数上限"
            />
          }
        />

        <SettingNumberRow
          label="新近度半衰期（天）"
          hint="越久远的轮次在排序中权重越低"
          input={
            <input
              type="number"
              min={0.1}
              max={365}
              step={0.5}
              disabled={saving || !form.enabled}
              value={form.halflife_days}
              onChange={(e) => setForm((prev) => ({ ...prev, halflife_days: Number(e.target.value) }))}
              onBlur={() => {
                const raw = form.halflife_days;
                const v =
                  Number.isFinite(raw) && raw > 0 ? Math.min(365, Math.max(0.1, raw)) : DEFAULTS.halflife_days;
                if (v !== form.halflife_days) void save({ halflife_days: v });
                else if (v !== lastSaved.halflife_days) void save({ halflife_days: v });
              }}
              className={`${TA_NUM_INPUT} w-16`}
              aria-label="新近度半衰期天数"
            />
          }
        />

        <button
          type="button"
          className="py-2 text-[11px] text-text-faint transition hover:text-text-subtle"
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "收起高级参数" : "展开高级参数"}
        </button>

        {/* Advanced params grouped in a soft container — less chrome, clearer hierarchy */}
        {showAdvanced ? (
          <div className="mt-1 space-y-0.5 rounded-lg bg-surface-card/50 px-3 py-1">
            <SettingNumberRow
              label="最小分块字数"
              hint="短于此长度的回复不单独归档"
              input={
                <input
                  type="number"
                  min={1}
                  max={500}
                  disabled={saving || !form.enabled}
                  value={form.min_chunk_chars}
                  onChange={(e) => setForm((prev) => ({ ...prev, min_chunk_chars: Number(e.target.value) }))}
                  onBlur={() => {
                    const v = Math.max(
                      1,
                      Math.min(500, Math.round(form.min_chunk_chars) || DEFAULTS.min_chunk_chars),
                    );
                    if (v !== lastSaved.min_chunk_chars) void save({ min_chunk_chars: v });
                  }}
                  className={`${TA_NUM_INPUT} w-16`}
                  aria-label="最小分块字数"
                />
              }
            />
            <SettingNumberRow
              label="每轮最大分块数"
              hint="单轮对话写入 turns 表的 chunk 上限"
              input={
                <input
                  type="number"
                  min={1}
                  max={20}
                  disabled={saving || !form.enabled}
                  value={form.max_chunks_per_turn}
                  onChange={(e) =>
                    setForm((prev) => ({ ...prev, max_chunks_per_turn: Number(e.target.value) }))
                  }
                  onBlur={() => {
                    const v = Math.max(
                      1,
                      Math.min(20, Math.round(form.max_chunks_per_turn) || DEFAULTS.max_chunks_per_turn),
                    );
                    if (v !== lastSaved.max_chunks_per_turn) void save({ max_chunks_per_turn: v });
                  }}
                  className={`${TA_NUM_INPUT} w-[3.25rem]`}
                  aria-label="每轮最大分块数"
                />
              }
            />
          </div>
        ) : null}
      </div>
      {message ? (
        <div className={`mt-2 text-xs ${message.startsWith("已保存") ? "text-text-muted" : "text-rose-400"}`}>
          {message}
        </div>
      ) : null}
    </Panel>
  );
}
