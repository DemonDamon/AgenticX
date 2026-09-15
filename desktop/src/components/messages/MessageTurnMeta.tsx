import { ArrowDown, ArrowUp, Sparkle } from "lucide-react";
import { useTranslation } from "react-i18next";

import type { MessageUsage, ModelSelection } from "../../store";
import { normalizeBareModelId } from "../../utils/model-display";
import {
  formatTurnCacheHit,
  formatTurnCacheHitLabel,
  formatTurnCacheHitTip,
  formatTurnModelLabel,
  formatTurnUsageSplit,
  formatTurnUsageTitle,
} from "../../utils/message-turn-meta";
import { HoverTip } from "../ds/HoverTip";

function TurnMetaRule({
  kind,
  lead = true,
}: {
  kind: "actions" | "model";
  lead?: boolean;
}) {
  if (kind === "model") {
    return (
      <span
        aria-hidden
        className="inline-flex w-2 shrink-0 select-none"
        data-turn-meta-sep="model"
      />
    );
  }
  return (
    <span className="inline-flex shrink-0 items-center" data-turn-meta-sep={kind}>
      {lead ? <span aria-hidden data-turn-meta-gutter="" className="w-2.5 shrink-0" /> : null}
      <span aria-hidden className="h-3 w-px self-center bg-border" />
      <span aria-hidden data-turn-meta-gutter="" className="w-2.5 shrink-0" />
    </span>
  );
}

function TurnUsageArrow({ direction }: { direction: "in" | "out" }) {
  const Icon = direction === "in" ? ArrowUp : ArrowDown;
  return (
    <span
      aria-hidden
      data-turn-usage-arrow={direction}
      className="inline-flex h-[15px] w-[15px] shrink-0 items-center justify-center rounded-[3.5px] bg-[color-mix(in_srgb,var(--status-success)_16%,transparent)] text-[var(--status-success)]"
    >
      <Icon size={11} strokeWidth={2.5} />
    </span>
  );
}

export function MessageTurnMeta({
  usage,
  model,
  modelSelection,
}: {
  usage?: MessageUsage;
  model?: string;
  modelSelection?: ModelSelection;
}) {
  const { t } = useTranslation("chat");
  const usageSplit = usage ? formatTurnUsageSplit(usage) : undefined;
  const cacheHit = usage ? formatTurnCacheHit(usage) : undefined;
  const isCacheHit = cacheHit && cacheHit.percent > 0;
  const bareModel = normalizeBareModelId(model ?? "");
  const modelLabel = formatTurnModelLabel(model, modelSelection);
  const isAuto = modelSelection === "auto" && Boolean(bareModel);
  if (!usageSplit && !modelLabel) return null;
  // Legacy rows carry neither model nor usage and are filtered above; a model
  // without usage is a real gap worth surfacing.
  const usageMissing = !usageSplit && Boolean(bareModel);

  const modelChip = modelLabel ? (
    <span
      data-turn-model-chip=""
      className="agx-liquid-glass-chip inline-flex h-5 w-max shrink-0 items-center gap-1 rounded-full px-3.5 text-[11px] font-medium leading-none cursor-default select-none"
      title={modelLabel}
    >
      <Sparkle
        size={10}
        className="agx-chip-sparkle shrink-0"
        strokeWidth={2}
      />
      {isAuto ? <span className="shrink-0 text-amber-200/70 [html[data-theme=light]_&]:text-amber-700/70 text-[10px]">auto</span> : null}
      <span className="whitespace-nowrap leading-none">
        {bareModel}
      </span>
    </span>
  ) : null;

  return (
    <span
      data-turn-meta=""
      className="inline-flex h-6 shrink-0 items-center select-none"
      title={
        usage
          ? formatTurnUsageTitle(usage, t)
          : usageMissing
            ? t("usage.missingTitle")
            : undefined
      }
    >
      <TurnMetaRule kind="actions" lead={false} />
      {usageMissing ? (
        <span className="text-[12px] leading-none text-text-faint">
          {t("usage.missingLabel")}
        </span>
      ) : null}
      {usageSplit ? (
        <span className="inline-flex min-w-0 items-center gap-2 overflow-hidden text-[12px] leading-none text-text-subtle">
          <span className="sr-only">{t("usage.turnCostSr")}</span>
          <span
            data-turn-usage-counts=""
            className="inline-flex shrink-0 items-center gap-2"
          >
            <span className="inline-flex items-center gap-0.5 tabular-nums">
              <TurnUsageArrow direction="in" />
              <span>{usageSplit.input}</span>
            </span>
            <span className="inline-flex items-center gap-0.5 tabular-nums">
              <TurnUsageArrow direction="out" />
              <span>{usageSplit.output}</span>
            </span>
          </span>
          {cacheHit ? (
            <span className="min-w-0 overflow-hidden">
              <HoverTip
                label={formatTurnCacheHitTip(cacheHit, t)}
                inline
                tooltipAlign="end"
                className="inline-flex items-center"
              >
                <span
                  data-turn-cache-hit=""
                  className={`whitespace-nowrap tabular-nums ${
                    isCacheHit
                      ? "font-medium text-emerald-400 [html[data-theme=light]_&]:text-emerald-600"
                      : "text-emerald-400/85 [html[data-theme=light]_&]:text-emerald-600/85"
                  }`}
                >
                  <span className="sr-only">{t("usage.cacheHitSr")}</span>
                  {formatTurnCacheHitLabel(cacheHit, t)}
                </span>
              </HoverTip>
            </span>
          ) : null}
        </span>
      ) : null}
      {modelChip && (usageSplit || usageMissing) ? (
        <span
          data-turn-model-cluster=""
          className="inline-flex shrink-0 items-center ml-1"
        >
          <TurnMetaRule kind="model" />
          {modelChip}
        </span>
      ) : (
        modelChip
      )}
    </span>
  );
}
