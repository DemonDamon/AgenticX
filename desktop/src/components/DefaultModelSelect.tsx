import { useMemo } from "react";
import { useAppStore } from "../store";
import { collectSelectableModelOptions, isModelSelectable } from "../utils/model-options";

type Props = {
  provider: string;
  model: string;
  onChange: (provider: string, model: string) => void;
  /** Placeholder label for the "inherit global default" option. */
  inheritLabel?: string;
};

/** Compact inline dropdown for picking an avatar's default provider/model. */
export function DefaultModelSelect({ provider, model, onChange, inheritLabel }: Props) {
  const settings = useAppStore((s) => s.settings);

  const options = useMemo(() => {
    return collectSelectableModelOptions(settings.providers, " | ").map((row) => ({
      value: `${row.provider}|${row.model}`,
      label: row.label,
      provider: row.provider,
      model: row.model,
    }));
  }, [settings.providers]);

  const current = provider && model ? `${provider}|${model}` : "";
  const placeholder = inheritLabel ?? "继承全局默认";
  const currentKnown =
    current === "" || isModelSelectable(provider, model, settings.providers);
  const selectValue = currentKnown ? current : "";

  return (
    <select
      className="mt-1 w-full rounded-md border border-border bg-surface-panel px-3 py-2 text-sm text-text-primary"
      value={selectValue}
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
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}
