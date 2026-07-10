import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";
import { useAppStore } from "../store";
import { collectSelectableModelOptions, isModelSelectable } from "../utils/model-options";

type Props = {
  provider: string;
  model: string;
  onChange: (provider: string, model: string) => void;
  /** Placeholder label for the "inherit global default" option. */
  inheritLabel?: string;
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

/** Compact inline dropdown for picking an avatar's default provider/model. */
export function DefaultModelSelect({ provider, model, onChange, inheritLabel }: Props) {
  const settings = useAppStore((s) => s.settings);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const options = useMemo(() => {
    return collectSelectableModelOptions(settings.providers, " | ").map((row) => ({
      value: `${row.provider}|${row.model}`,
      label: row.label,
      provider: row.provider,
      model: row.model,
    }));
  }, [settings.providers]);

  const placeholder = inheritLabel ?? "继承全局默认";
  const currentKnown = provider && model && isModelSelectable(provider, model, settings.providers);
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
        onClick={() => setOpen((v) => !v)}
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
              {options.length === 0 ? (
                <div className="px-3 py-2 text-center text-xs text-text-faint">请先在设置中配置 Provider 和模型</div>
              ) : (
                options.map((opt) => {
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
                      <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                      <span className="flex w-4 shrink-0 justify-end">
                        {isActive ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : null}
                      </span>
                    </button>
                  );
                })
              )}
            </div>
          </>,
          document.body,
        )}
    </div>
  );
}
