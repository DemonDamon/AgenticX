import { useEffect, useState } from "react";

const MIN_ROUNDS = 10;
const MAX_ROUNDS = 120;
const STEP = 10;

export function RuntimeConfigSection() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [value, setValue] = useState(60);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let disposed = false;
    const load = async () => {
      setLoading(true);
      setMessage("");
      try {
        const result = await window.agenticxDesktop.loadRuntimeConfig();
        if (!disposed && result?.ok) {
          setValue(result.max_tool_rounds ?? 60);
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

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setValue(Number(e.target.value));
    setMessage("");
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = Number(e.target.value);
    if (Number.isNaN(raw)) return;
    const clamped = Math.max(MIN_ROUNDS, Math.min(MAX_ROUNDS, raw));
    setValue(clamped);
    setMessage("");
  };

  const handleSave = async () => {
    setSaving(true);
    setMessage("");
    try {
      const result = await window.agenticxDesktop.saveRuntimeConfig({
        max_tool_rounds: value,
      });
      if (!result?.ok) {
        setMessage(result?.error ? String(result.error) : "保存失败。");
        return;
      }
      setMessage("已保存。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败。");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-xl border border-border bg-surface-card px-4 py-3.5">
      <div className="text-sm font-semibold text-text-strong">运行时参数</div>
      <p className="mt-1 text-xs leading-relaxed text-text-muted">
        Agent 单次对话中可连续调用工具的最大轮数。长任务建议适当提高。
      </p>

      <div className="mt-3 flex items-center gap-3">
        <input
          type="range"
          min={MIN_ROUNDS}
          max={MAX_ROUNDS}
          step={STEP}
          value={value}
          onChange={handleSliderChange}
          disabled={loading}
          className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-surface-card-strong accent-text-strong disabled:opacity-50"
        />
        <input
          type="number"
          min={MIN_ROUNDS}
          max={MAX_ROUNDS}
          step={STEP}
          value={value}
          onChange={handleInputChange}
          disabled={loading}
          className="w-16 rounded-md border border-border bg-surface-panel px-2 py-1 text-center text-xs text-text-primary disabled:opacity-50"
        />
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          disabled={saving || loading}
          onClick={() => void handleSave()}
          className={`rounded-md px-3 py-1 text-xs font-medium text-white transition ${
            saving || loading
              ? "bg-text-muted opacity-50"
              : "bg-text-strong hover:opacity-90"
          }`}
        >
          {saving ? "保存中…" : "保存"}
        </button>

        {message ? (
          <span
            className={`text-xs ${
              message.startsWith("已保存") ? "text-text-faint" : "text-rose-400"
            }`}
          >
            {message}
          </span>
        ) : null}
      </div>
    </div>
  );
}
