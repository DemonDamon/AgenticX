/**
 * Scratch-chat message actions: copy / quote / edit / retry / select.
 * Same icon set as the main chat row; no favorite / forward / open-scratch.
 *
 * Author: Damon Li
 */

import { Copy, LayoutList, Pencil, Quote, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HoverTip } from "../ds/HoverTip";

type Props = {
  align: "start" | "end";
  selected?: boolean;
  canEdit?: boolean;
  canRetry?: boolean;
  onCopy: () => void;
  onQuote: () => void;
  onEdit?: () => void;
  onRetry?: () => void;
  onSelect: () => void;
};

export function ScratchMessageActions({
  align,
  selected = false,
  canEdit = false,
  canRetry = false,
  onCopy,
  onQuote,
  onEdit,
  onRetry,
  onSelect,
}: Props) {
  const { t } = useTranslation(["chat", "workspace"]);
  return (
    <div
      data-slot="scratch-actions"
      className={`mt-1.5 flex items-center gap-[0.35rem] ${
        align === "end" ? "justify-end" : "justify-start"
      }`}
    >
      <HoverTip label={t("actions.copy", { ns: "chat" })} tooltipAlign={align === "end" ? "end" : "center"}>
        <button
          type="button"
          data-slot="scratch-action-copy"
          aria-label={t("actions.copy", { ns: "chat" })}
          className="inline-flex h-5 w-5 items-center justify-center rounded-[0.35rem] text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onCopy}
        >
          <Copy size={14} strokeWidth={2} />
        </button>
      </HoverTip>
      <HoverTip label={t("actions.quote", { ns: "chat" })}>
        <button
          type="button"
          data-slot="scratch-action-quote"
          aria-label={t("actions.quote", { ns: "chat" })}
          className="inline-flex h-5 w-5 items-center justify-center rounded-[0.35rem] text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onQuote}
        >
          <Quote size={14} strokeWidth={2} />
        </button>
      </HoverTip>
      {canEdit && onEdit ? (
        <HoverTip label={t("actions.edit", { ns: "chat" })}>
          <button
            type="button"
            data-slot="scratch-action-edit"
            aria-label={t("actions.edit", { ns: "chat" })}
            className="inline-flex h-5 w-5 items-center justify-center rounded-[0.35rem] text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onEdit}
          >
            <Pencil size={14} strokeWidth={2} />
          </button>
        </HoverTip>
      ) : null}
      {canRetry && onRetry ? (
        <HoverTip label={t("actions.retry", { ns: "chat" })}>
          <button
            type="button"
            data-slot="scratch-retry"
            aria-label={t("work.scratchRetry", { ns: "workspace" })}
            className="inline-flex h-5 w-5 items-center justify-center rounded-[0.35rem] text-text-muted transition hover:bg-surface-hover hover:text-text-strong"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onRetry}
          >
            <RotateCcw size={14} strokeWidth={2} />
          </button>
        </HoverTip>
      ) : null}
      <HoverTip label={t("actions.select", { ns: "chat" })} tooltipAlign="end">
        <button
          type="button"
          data-slot="scratch-action-select"
          aria-label={t("actions.select", { ns: "chat" })}
          className={`inline-flex h-5 w-5 items-center justify-center rounded-[0.35rem] transition hover:bg-surface-hover ${
            selected
              ? "text-[rgb(var(--theme-color-rgb,59,130,246))] hover:opacity-90"
              : "text-text-muted hover:text-text-strong"
          }`}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onSelect}
        >
          <LayoutList size={14} strokeWidth={2} />
        </button>
      </HoverTip>
    </div>
  );
}
