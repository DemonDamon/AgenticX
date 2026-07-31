"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  cn,
} from "@agenticx/ui";
import { Check, ChevronRight, Globe, Paperclip, Plus, X } from "lucide-react";

export type WebSearchMode = "auto" | "off";

/** 菜单行悬停：实底灰底，避免 muted/70 在 popover 上几乎看不见 */
const menuItemClass =
  "flex w-full cursor-pointer items-center gap-2.5 rounded-xl px-2.5 py-2 text-left text-sm text-foreground transition-colors hover:bg-black/[0.06] focus-visible:bg-black/[0.06] focus-visible:outline-none dark:hover:bg-white/10 dark:focus-visible:bg-white/10";

const submenuItemClass =
  "flex w-full cursor-pointer items-start gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-black/[0.06] focus-visible:bg-black/[0.06] focus-visible:outline-none dark:hover:bg-white/10 dark:focus-visible:bg-white/10";

/**
 * Kimi-style dark capability tip (beak below). Content must reflect real product limits.
 * Uses CSS group-hover so it works inside Popover without nested Tooltip focus traps.
 */
function CapabilityHoverTip({
  label,
  lines,
  children,
  disabled = false,
}: {
  label: string;
  lines: string[];
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div className="group/cap relative">
      {children}
      {!disabled && lines.length > 0 ? (
        <div
          role="tooltip"
          aria-label={label}
          className={cn(
            "pointer-events-none absolute bottom-[calc(100%+6px)] left-1/2 z-40 w-max max-w-[17rem] -translate-x-1/2",
            "hidden flex-col items-center group-hover/cap:flex group-focus-within/cap:flex",
          )}
        >
          <div className="rounded-xl bg-zinc-900 px-3 py-2 text-left text-[12px] leading-[1.45] text-white shadow-lg dark:bg-zinc-800">
            {lines.map((line) => (
              <p key={line} className="whitespace-normal">
                {line}
              </p>
            ))}
          </div>
          <div
            className="h-0 w-0 border-x-[6px] border-t-[6px] border-x-transparent border-t-zinc-900 dark:border-t-zinc-800"
            aria-hidden
          />
        </div>
      ) : null}
    </div>
  );
}

function hintLines(raw: string): string[] {
  return raw
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

type ComposerPlusMenuProps = {
  webSearchMode: WebSearchMode;
  onWebSearchModeChange: (mode: WebSearchMode) => void;
  onPickFiles: () => void;
  showFileEntry?: boolean;
  /** 新建对话空态向下展开，避免挡住输入框；有消息时向上展开 */
  menuSide?: "top" | "bottom";
  className?: string;
};

export function ComposerPlusMenu({
  webSearchMode,
  onWebSearchModeChange,
  onPickFiles,
  showFileEntry = true,
  menuSide = "top",
  className,
}: ComposerPlusMenuProps) {
  const t = useTranslations("chat");
  const [open, setOpen] = React.useState(false);
  const [webSearchOpen, setWebSearchOpen] = React.useState(false);

  const filesHint = hintLines(t("filesAndImagesHint"));
  const webSearchHint = hintLines(t("webSearchMenuHint"));

  React.useEffect(() => {
    if (!open) setWebSearchOpen(false);
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("plusMenuTooltip")}
              className={cn(
                "h-8 w-8 rounded-full text-muted-foreground hover:text-foreground",
                open ? "bg-muted text-foreground" : "",
                className,
              )}
            >
              {open ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        {!open ? <TooltipContent>{t("plusMenuTooltip")}</TooltipContent> : null}
      </Tooltip>

      <PopoverContent
        side={menuSide}
        align="start"
        sideOffset={8}
        className="w-44 overflow-visible rounded-2xl border-border/70 bg-popover p-1 shadow-xl"
      >
        {showFileEntry ? (
          <CapabilityHoverTip label={t("filesAndImages")} lines={filesHint}>
            <button
              type="button"
              className={menuItemClass}
              onMouseEnter={() => setWebSearchOpen(false)}
              onClick={() => {
                setOpen(false);
                onPickFiles();
              }}
            >
              <Paperclip className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 font-medium">{t("filesAndImages")}</span>
            </button>
          </CapabilityHoverTip>
        ) : null}

        <div
          className="relative"
          onMouseEnter={() => setWebSearchOpen(true)}
          onMouseLeave={() => setWebSearchOpen(false)}
        >
          <CapabilityHoverTip label={t("webSearchMenu")} lines={webSearchHint}>
            <button
              type="button"
              className={cn(menuItemClass, webSearchOpen && "bg-black/[0.06] dark:bg-white/10")}
              onClick={() => setWebSearchOpen((v) => !v)}
            >
              <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1 font-medium">{t("webSearchMenu")}</span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
          </CapabilityHoverTip>

          {webSearchOpen ? (
            <div
              className={cn(
                "absolute left-full z-20 pl-1.5",
                menuSide === "bottom" ? "top-0" : "bottom-0",
              )}
            >
              {/* w-max：按文案收紧宽度；预留勾选位避免选中时左右不齐 */}
              <div className="w-max max-w-[14.5rem] rounded-2xl border border-border/70 bg-popover p-1 shadow-xl">
                <button
                  type="button"
                  className={submenuItemClass}
                  onClick={() => {
                    onWebSearchModeChange("auto");
                    setWebSearchOpen(false);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t("webSearchAuto")}</span>
                    <span className="mt-0.5 block whitespace-nowrap text-xs text-muted-foreground">
                      {t("webSearchAutoHint")}
                    </span>
                  </span>
                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
                    {webSearchMode === "auto" ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : null}
                  </span>
                </button>
                <button
                  type="button"
                  className={submenuItemClass}
                  onClick={() => {
                    onWebSearchModeChange("off");
                    setWebSearchOpen(false);
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{t("webSearchOff")}</span>
                    <span className="mt-0.5 block whitespace-nowrap text-xs text-muted-foreground">
                      {t("webSearchOffHint")}
                    </span>
                  </span>
                  <span className="mt-0.5 inline-flex h-4 w-4 shrink-0 items-center justify-center">
                    {webSearchMode === "off" ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : null}
                  </span>
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
  );
}
