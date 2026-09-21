/**
 * Compact model picker for scratch-chat composer.
 *
 * Author: Damon Li
 */

import { Check, ChevronDown } from "lucide-react";
import { useCallback, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import { formatModelOptionLabel } from "../../utils/model-display";
import { collectSelectableModelOptions, isModelSelectable } from "../../utils/model-options";
import { ProviderIcon } from "../ProviderIcon";

function pickerPanelStyle(anchor: DOMRect): CSSProperties {
  const width = Math.min(280, Math.max(220, anchor.width + 48));
  const left = Math.min(Math.max(8, anchor.left), window.innerWidth - width - 8);
  const top = Math.min(anchor.bottom + 6, window.innerHeight - 220);
  return { position: "fixed", top, left, width, zIndex: 200 };
}

export function ScratchModelPicker({
  provider,
  model,
  onChange,
}: {
  provider?: string;
  model?: string;
  onChange: (provider: string, model: string) => void;
}) {
  const { t } = useTranslation("workspace");
  const settings = useAppStore((s) => s.settings.providers);
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});

  const options = useMemo(() => collectSelectableModelOptions(settings), [settings]);
  const currentProvider = (provider ?? "").trim();
  const currentModel = (model ?? "").trim();
  const label = useMemo(() => {
    if (!currentModel) return t("work.scratchPickModel");
    if (!currentProvider) return currentModel;
    if (!isModelSelectable(currentProvider, currentModel, settings)) return t("work.scratchPickModel");
    return formatModelOptionLabel(currentProvider, currentModel, settings[currentProvider]);
  }, [currentModel, currentProvider, settings, t]);

  const syncPanelPosition = useCallback(() => {
    const el = anchorRef.current;
    if (!el) return;
    setPanelStyle(pickerPanelStyle(el.getBoundingClientRect()));
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

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        data-slot="scratch-model-picker"
        className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-full border border-border bg-surface-card-strong px-2 py-0.5 text-[11px] text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
        title={label}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        <ProviderIcon provider={currentProvider} model={currentModel} className="h-3 w-3 shrink-0" />
        <span className="min-w-0 truncate">{label}</span>
        <ChevronDown className={`h-3 w-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} strokeWidth={2} />
      </button>
      {open &&
        createPortal(
          <>
            <div className="fixed inset-0 z-[199]" onClick={() => setOpen(false)} />
            <div
              className="fixed z-[200] max-h-56 overflow-y-auto rounded-xl border border-border bg-surface-panel p-1.5 shadow-xl"
              style={panelStyle}
            >
              {options.length === 0 ? (
                <div className="px-3 py-2 text-center text-[11px] text-text-muted">
                  {t("work.scratchConfigureModels")}
                </div>
              ) : (
                options.map((opt) => {
                  const isActive = opt.provider === currentProvider && opt.model === currentModel;
                  return (
                    <button
                      key={`${opt.provider}:${opt.model}`}
                      type="button"
                      className={`flex w-full min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] text-text-primary transition-colors ${
                        isActive ? "bg-surface-hover" : "hover:bg-surface-hover"
                      }`}
                      title={opt.label}
                      onClick={() => {
                        onChange(opt.provider, opt.model);
                        setOpen(false);
                      }}
                    >
                      <ProviderIcon provider={opt.provider} model={opt.model} className="h-3 w-3 shrink-0" />
                      <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                      {isActive ? <Check className="h-3 w-3 shrink-0" strokeWidth={2} /> : null}
                    </button>
                  );
                })
              )}
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
