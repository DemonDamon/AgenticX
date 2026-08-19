import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { useAppStore, type ProviderEntry } from "../store";
import { collectSelectableModelOptions, isModelSelectable } from "../utils/model-options";
import { getProviderDisplayName } from "../utils/provider-display";

type Props = {
  provider: string;
  model: string;
  onChange: (provider: string, model: string) => void;
  /** Placeholder label for the "inherit global default" option. */
  inheritLabel?: string;
  /** Avatar editors allow inheritance; the global default picker must not. */
  allowInherit?: boolean;
  /** Optional persisted snapshot; avoids reading unrelated in-panel drafts. */
  providersSnapshot?: Record<string, ProviderEntry>;
};

const PICKER_MARGIN = 8;
const PICKER_GAP = 4;
const PICKER_MIN_MAX_HEIGHT = 120;

function defaultModelPickerPanelStyle(anchor: DOMRect): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const panelWidth = Math.min(Math.max(anchor.width, 280), vw - PICKER_MARGIN * 2);

  let left = anchor.left;
  if (left + panelWidth > vw - PICKER_MARGIN) {
    left = vw - PICKER_MARGIN - panelWidth;
  }
  if (left < PICKER_MARGIN) left = PICKER_MARGIN;

  const spaceBelow = vh - anchor.bottom - PICKER_MARGIN - PICKER_GAP;
  const spaceAbove = anchor.top - PICKER_MARGIN - PICKER_GAP;
  const preferBelow = spaceBelow >= PICKER_MIN_MAX_HEIGHT || spaceBelow >= spaceAbove;

  if (preferBelow) {
    return {
      left,
      width: panelWidth,
      maxHeight: Math.max(PICKER_MIN_MAX_HEIGHT, Math.floor(spaceBelow)),
      top: anchor.bottom + PICKER_GAP,
    };
  }

  return {
    left,
    width: panelWidth,
    maxHeight: Math.max(PICKER_MIN_MAX_HEIGHT, Math.floor(spaceAbove)),
    bottom: vh - anchor.top + PICKER_GAP,
    top: "auto",
  };
}

/** Compact inline dropdown for picking a provider/model pair. */
export function DefaultModelSelect({
  provider,
  model,
  onChange,
  inheritLabel,
  allowInherit = true,
  providersSnapshot,
}: Props) {
  const settings = useAppStore((s) => s.settings);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);

  const selectableProviders = providersSnapshot ?? settings.providers;
  const options = useMemo(() => {
    return collectSelectableModelOptions(selectableProviders, " | ").map((row) => ({
      value: `${row.provider}|${row.model}`,
      label: row.label,
      provider: row.provider,
      model: row.model,
    }));
  }, [selectableProviders]);

  const providerGroups = useMemo(() => {
    const byProvider = new Map<string, typeof options>();
    for (const option of options) {
      const items = byProvider.get(option.provider) ?? [];
      items.push(option);
      byProvider.set(option.provider, items);
    }
    return [...byProvider.entries()].map(([providerId, items]) => ({
      provider: providerId,
      items,
      label: getProviderDisplayName(providerId, selectableProviders[providerId]),
    }));
  }, [options, selectableProviders]);
  const selectedProviderGroup = expandedProvider
    ? providerGroups.find((group) => group.provider === expandedProvider) ?? null
    : null;

  const placeholder = inheritLabel ?? "继承全局默认";
  const currentKnown = provider && model && isModelSelectable(provider, model, selectableProviders);
  const inheritSelected = !currentKnown;

  const displayLabel = useMemo(() => {
    if (inheritSelected) return placeholder;
    const found = options.find((opt) => opt.provider === provider && opt.model === model);
    return found?.label ?? placeholder;
  }, [inheritSelected, options, placeholder, provider, model]);

  const syncPanelPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    setPanelStyle(defaultModelPickerPanelStyle(el.getBoundingClientRect()));
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    syncPanelPosition();
    const onReflow = () => syncPanelPosition();
    window.addEventListener("resize", onReflow);
    window.addEventListener("scroll", onReflow, true);
    return () => {
      window.removeEventListener("resize", onReflow);
      window.removeEventListener("scroll", onReflow, true);
    };
  }, [open, syncPanelPosition, options.length]);

  const handleSelect = (nextProvider: string, nextModel: string) => {
    onChange(nextProvider, nextModel);
    setExpandedProvider(null);
    setOpen(false);
  };

  return (
    <div className="relative mt-1">
      <button
        ref={anchorRef}
        type="button"
        className="flex w-full items-center gap-2 rounded-md border border-border bg-surface-panel px-3 py-2 text-left text-sm text-text-primary transition hover:bg-surface-hover focus:outline-none focus-visible:border-[rgba(var(--theme-color-rgb),0.5)] focus-visible:ring-1 focus-visible:ring-[rgba(var(--theme-color-rgb),0.5)]"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => {
          setExpandedProvider(null);
          setOpen((v) => !v);
        }}
      >
        <span className="min-w-0 flex-1 truncate">{displayLabel}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-text-faint transition-transform ${open ? "rotate-180" : ""}`}
          strokeWidth={2}
          aria-hidden
        />
      </button>
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[70]" onClick={() => setOpen(false)} />
            <div
              className="fixed z-[80] overflow-y-auto rounded-xl border border-border p-1.5 shadow-2xl"
              style={{ ...panelStyle, backgroundColor: "var(--surface-base-fallback, var(--surface-panel))" }}
              role="listbox"
            >
              {allowInherit ? (
                <button
                  type="button"
                  className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                    inheritSelected ? "bg-surface-hover text-text-strong" : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
                  }`}
                  onClick={() => handleSelect("", "")}
                >
                  <span className="min-w-0 flex-1 truncate">{placeholder}</span>
                  <span className="flex w-4 shrink-0 justify-end">
                    {inheritSelected ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : null}
                  </span>
                </button>
              ) : null}
              {options.length === 0 ? (
                <div className="px-3 py-2 text-center text-xs text-text-faint">请先在设置中配置 Provider 和模型</div>
              ) : !selectedProviderGroup ? (
                <>
                  <div className="px-2.5 pb-1.5 text-[11px] text-text-faint">先选择模型提供商</div>
                  {providerGroups.map((group) => (
                    <button
                      key={group.provider}
                      type="button"
                      className="flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-text-muted transition-colors hover:bg-surface-hover hover:text-text-strong"
                      onClick={() => setExpandedProvider(group.provider)}
                    >
                      <span className="min-w-0 flex-1 truncate font-medium">{group.label}</span>
                      <span className="shrink-0 text-[11px] text-text-faint">{group.items.length} 个模型</span>
                      <span className="text-xs text-text-faint">›</span>
                    </button>
                  ))}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    className="mb-1 flex w-full min-w-0 items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-left text-xs text-text-subtle transition-colors hover:bg-surface-hover hover:text-text-strong"
                    onClick={() => setExpandedProvider(null)}
                  >
                    <span aria-hidden>‹</span>
                    <span>全部提供商</span>
                  </button>
                  <div className="px-2.5 pb-1 text-[11px] font-medium text-text-faint">{selectedProviderGroup.label} · 选择模型</div>
                  {selectedProviderGroup.items.map((opt) => {
                    const isActive = !inheritSelected && opt.provider === provider && opt.model === model;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
                          isActive ? "bg-surface-hover text-text-strong" : "text-text-muted hover:bg-surface-hover hover:text-text-strong"
                        }`}
                        title={opt.label}
                        onClick={() => handleSelect(opt.provider, opt.model)}
                      >
                        <span className="min-w-0 flex-1 truncate">{opt.model}</span>
                        <span className="flex w-4 shrink-0 justify-end">
                          {isActive ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : null}
                        </span>
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
