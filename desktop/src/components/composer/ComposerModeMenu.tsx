import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Sparkles } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingsSwitch } from "../settings/SettingsSwitch";
import {
  applyTurnIntentToggle,
  type TurnIntent,
} from "../../utils/turn-intent";

export const COMPOSER_MODE_MENU_ID = "agx-composer-mode-menu";
const MODE_FLYOUT_WIDTH = 260;

function modeFlyoutStyle(trigger: HTMLElement): { top: number; left: number } {
  const parent = trigger.closest(".agx-menu-pop");
  const band = (parent ?? trigger).getBoundingClientRect();
  const gap = 8;
  let left = band.right + gap;
  if (left + MODE_FLYOUT_WIDTH > window.innerWidth - gap) {
    left = band.left - MODE_FLYOUT_WIDTH - gap;
  }
  left = Math.max(gap, Math.min(left, window.innerWidth - MODE_FLYOUT_WIDTH - gap));
  return { top: band.top, left };
}

function modeHintKey(intent: TurnIntent): "composer.modePlanHint" | "composer.modeMultitaskHint" | "composer.modeDefaultHint" {
  if (intent === "plan") return "composer.modePlanHint";
  if (intent === "isolate") return "composer.modeMultitaskHint";
  return "composer.modeDefaultHint";
}

export function ComposerModeMenu({
  intent,
  onIntentChange,
}: {
  intent: TurnIntent;
  onIntentChange: (next: TurnIntent) => void;
}) {
  const { t } = useTranslation("chat");
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  const openFlyout = useCallback(() => {
    if (!btnRef.current) return;
    setPos(modeFlyoutStyle(btnRef.current));
    setOpen(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      const node = event.target as Node;
      if (btnRef.current?.contains(node) || panelRef.current?.contains(node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const description = t(modeHintKey(intent));

  const flyout =
    open && pos
      ? createPortal(
          <div
            id={COMPOSER_MODE_MENU_ID}
            ref={panelRef}
            role="menu"
            style={{ top: pos.top, left: pos.left, width: MODE_FLYOUT_WIDTH }}
            className="fixed z-[9999] rounded-xl border border-border bg-surface-panel p-1.5 shadow-xl backdrop-blur-xl"
          >
            <p className="px-2.5 py-2 text-[12px] leading-snug text-text-muted">{description}</p>
            <div className="mx-1.5 border-t border-border" />
            <div className="flex items-center justify-between gap-3 px-2.5 py-2">
              <span className="text-[13px] text-text-primary">{t("composer.modePlan")}</span>
              <SettingsSwitch
                size="sm"
                checked={intent === "plan"}
                aria-label={t("composer.modePlan")}
                onChange={(enabled) => onIntentChange(applyTurnIntentToggle(intent, "plan", enabled))}
              />
            </div>
            <div className="flex items-center justify-between gap-3 px-2.5 py-2">
              <span className="text-[13px] text-text-primary">{t("composer.modeMultitask")}</span>
              <SettingsSwitch
                size="sm"
                checked={intent === "isolate"}
                aria-label={t("composer.modeMultitask")}
                onChange={(enabled) => onIntentChange(applyTurnIntentToggle(intent, "isolate", enabled))}
              />
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        role="menuitem"
        className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors hover:bg-surface-hover ${
          open ? "bg-surface-hover text-text-strong" : "text-text-standard"
        }`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${t("composer.mode")}. ${description}`}
        onClick={() => {
          if (open) setOpen(false);
          else openFlyout();
        }}
      >
        <Sparkles className="h-[15px] w-[15px] shrink-0 text-text-muted" strokeWidth={1.8} aria-hidden />
        <span className="flex-1">{t("composer.mode")}</span>
        <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-faint" aria-hidden />
      </button>
      {flyout}
    </>
  );
}
