import { ArrowDown, ArrowUp } from "lucide-react";
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
      className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] bg-[color-mix(in_srgb,var(--status-success)_18%,transparent)] text-[var(--status-success)]"
    >
      <Icon size={12} strokeWidth={2.25} />
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
      className="inline-flex min-h-5 min-w-0 max-w-[13rem] items-center gap-1 rounded-md bg-surface-card-strong px-1 text-[13px] leading-5 text-text-subtle"
      title={modelLabel}
    >
      {isAuto ? <span className="shrink-0 text-text-faint">auto</span> : null}
      <span className="min-w-0 overflow-x-hidden text-ellipsis whitespace-nowrap leading-5">
        {bareModel}
      </span>
    </span>
  ) : null;

  return (
    <span
      data-turn-meta=""
      className="inline-flex min-h-5 min-w-0 items-center overflow-hidden select-none"
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
        <span className="text-[13px] leading-none text-text-faint">
          {t("usage.missingLabel")}
        </span>
      ) : null}
      {usageSplit ? (
        <span className="inline-flex min-w-0 items-center gap-2.5 overflow-hidden text-[13px] leading-none text-text-subtle">
          <span className="sr-only">{t("usage.turnCostSr")}</span>
          <span
            data-turn-usage-counts=""
            className="inline-flex shrink-0 items-center gap-2.5"
          >
            <span className="inline-flex items-center gap-1 tabular-nums">
              <TurnUsageArrow direction="in" />
              <span>{usageSplit.input}</span>
            </span>
            <span className="inline-flex items-center gap-1 tabular-nums">
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
                  className="whitespace-nowrap tabular-nums text-emerald-400 [html[data-theme=light]_&]:text-emerald-600"
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
          className="inline-flex min-w-0 items-center overflow-hidden"
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
