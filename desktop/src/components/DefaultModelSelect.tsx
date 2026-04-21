import { useMemo } from "react";
import { useAppStore } from "../store";
import { getProviderDisplayName } from "../utils/provider-display";

type Props = {
  provider: string;
  model: string;
  onChange: (provider: string, model: string) => void;
  /** Placeholder label for the "inherit global default" option. */
  inheritLabel?: string;
};

/** Compact inline dropdown for picking an avatar's default provider/model.
 *
 * The dropdown lists every enabled provider × configured model tuple drawn from
 * settings, plus a leading "inherit global default" entry (empty value).
 * Two separate strings are emitted to the caller so the Avatar record can keep
 * provider and model as orthogonal fields (matches backend avatar.yaml).
 */
export function DefaultModelSelect({ provider, model, onChange, inheritLabel }: Props) {
  const settings = useAppStore((s) => s.settings);

  const options = useMemo<Array<{ value: string; label: string; provider: string; model: string }>>(() => {
    const rows: Array<{ value: string; label: string; provider: string; model: string }> = [];
    for (const [provName, entry] of Object.entries(settings.providers)) {
      if (entry.enabled === false) continue;
      if (!entry.apiKey) continue;
      const provLabel = getProviderDisplayName(provName, entry);
      if (entry.models.length > 0) {
        for (const m of entry.models) {
          rows.push({
            value: `${provName}|${m}`,
            label: `${provLabel} | ${m}`,
            provider: provName,
            model: m,
          });
        }
      } else if (entry.model) {
        rows.push({
          value: `${provName}|${entry.model}`,
          label: `${provLabel} | ${entry.model}`,
          provider: provName,
          model: entry.model,
        });
      }
    }
    return rows;
  }, [settings.providers]);

  const current = provider && model ? `${provider}|${model}` : "";
  const placeholder = inheritLabel ?? "继承全局默认";
  const currentKnown = current === "" || options.some((opt) => opt.value === current);

  return (
    <select
      className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
      value={current}
      onChange={(e) => {
        const v = e.target.value;
        if (!v) {
          onChange("", "");
          return;
        }
        const idx = v.indexOf("|");
        if (idx < 0) {
          onChange("", "");
          return;
        }
        onChange(v.slice(0, idx), v.slice(idx + 1));
      }}
    >
      <option value="">{placeholder}</option>
      {!currentKnown && current ? (
        <option value={current}>{`${provider} | ${model}`}（已保存，但当前 Provider 不可用）</option>
      ) : null}
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
