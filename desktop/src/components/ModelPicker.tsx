import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "../store";
import { collectSelectableModelOptions } from "../utils/model-options";
import { getProviderDisplayName } from "../utils/provider-display";

type ModelOption = { provider: string; model: string; label: string };

type Props = {
  open: boolean;
  anchorRef?: React.RefObject<HTMLElement | null>;
  onSelect: (provider: string, model: string) => void;
  onClose: () => void;
};

export function ModelPicker({ open, onSelect, onClose }: Props) {
  const settings = useAppStore((s) => s.settings);

  const options = useMemo<ModelOption[]>(
    () => collectSelectableModelOptions(settings.providers, " | "),
    [settings.providers],
  );
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const groups = useMemo(() => {
    const byProvider = new Map<string, ModelOption[]>();
    for (const option of options) {
      const items = byProvider.get(option.provider) ?? [];
      items.push(option);
      byProvider.set(option.provider, items);
    }
    return [...byProvider.entries()].map(([provider, items]) => ({
      provider,
      items,
      label: getProviderDisplayName(provider, settings.providers[provider]),
    }));
  }, [options, settings.providers]);

  useEffect(() => {
    if (!open) setExpandedProvider(null);
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div className="absolute bottom-full left-0 z-40 mb-1 max-h-[280px] w-[280px] overflow-y-auto rounded-lg border border-border bg-surface-panel shadow-xl">
        {options.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-text-faint">
            请先在设置中配置 Provider 和模型
          </div>
        ) : !expandedProvider ? (
          <>
            <div className="px-3 pb-2 text-[11px] text-text-faint">先选择模型提供商</div>
            {groups.map((group) => (
              <button
                key={group.provider}
                type="button"
                className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
                onClick={() => setExpandedProvider(group.provider)}
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                <span className="min-w-0 flex-1 truncate font-medium">{group.label}</span>
                <span className="shrink-0 text-[11px] text-text-faint">{group.items.length} 个模型</span>
                <span className="text-xs text-text-faint">›</span>
              </button>
            ))}
          </>
        ) : (
          (() => {
            const group = groups.find((item) => item.provider === expandedProvider);
            if (!group) return null;
            return (
              <>
                <button
                  type="button"
                  className="mb-1 flex w-full items-center gap-1.5 px-3 py-1.5 text-left text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
                  onClick={() => setExpandedProvider(null)}
                >
                  <span aria-hidden>‹</span>
                  <span>全部提供商</span>
                </button>
                <div className="px-3 pb-1 text-[11px] font-medium text-text-faint">{group.label} · 选择模型</div>
                {group.items.map((opt) => (
                  <button
                    key={`${opt.provider}:${opt.model}`}
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-text-muted transition hover:font-bold hover:text-text-strong"
                    onClick={() => {
                      onSelect(opt.provider, opt.model);
                      onClose();
                    }}
                  >
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                    <span className="truncate">{opt.model}</span>
                  </button>
                ))}
              </>
            );
          })()
        )}
      </div>
    </>
  );
}
