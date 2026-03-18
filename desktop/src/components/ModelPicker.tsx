import { useMemo } from "react";
import { useAppStore } from "../store";

type ModelOption = { provider: string; model: string; label: string };

type Props = {
  open: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
  onSelect: (provider: string, model: string) => void;
  onClose: () => void;
};

export function ModelPicker({ open, onSelect, onClose }: Props) {
  const settings = useAppStore((s) => s.settings);

  const options = useMemo<ModelOption[]>(() => {
    const result: ModelOption[] = [];
    for (const [provName, entry] of Object.entries(settings.providers)) {
      if (!entry.apiKey) continue;
      if (entry.models.length > 0) {
        for (const m of entry.models) {
          result.push({ provider: provName, model: m, label: `${provName} | ${m}` });
        }
      } else if (entry.model) {
        result.push({ provider: provName, model: entry.model, label: `${provName} | ${entry.model}` });
      }
    }
    return result;
  }, [settings.providers]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute bottom-full left-0 z-40 mb-1 max-h-[280px] w-[280px] overflow-y-auto rounded-lg border border-border bg-surface-panel shadow-xl">
        {options.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-text-faint">
            请先在设置中配置 Provider 和模型
          </div>
        ) : (
          options.map((opt) => (
            <button
              key={`${opt.provider}:${opt.model}`}
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-muted transition hover:bg-cyan-500/10 hover:text-text-strong"
              onClick={() => {
                onSelect(opt.provider, opt.model);
                onClose();
              }}
            >
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-400" />
              <span className="truncate">{opt.label}</span>
            </button>
          ))
        )}
      </div>
    </>
  );
}
