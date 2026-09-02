import { ArrowDown, ArrowUp } from "lucide-react";

import type { MessageUsage, ModelSelection } from "../../store";
import { normalizeBareModelId } from "../../utils/model-display";
import {
  formatTurnModelLabel,
  formatTurnUsageSplit,
  formatTurnUsageTitle,
  TURN_USAGE_MISSING_LABEL,
  TURN_USAGE_MISSING_TITLE,
} from "../../utils/message-turn-meta";

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
  const usageSplit = usage ? formatTurnUsageSplit(usage) : undefined;
  const bareModel = normalizeBareModelId(model ?? "");
  const modelLabel = formatTurnModelLabel(model, modelSelection);
  const isAuto = modelSelection === "auto" && Boolean(bareModel);
  if (!usageSplit && !modelLabel) return null;
  // Legacy rows carry neither model nor usage and are filtered above; a model
  // without usage is a real gap worth surfacing.
  const usageMissing = !usageSplit && Boolean(bareModel);

  return (
    <span
      data-turn-meta=""
      className="inline-flex h-5 min-w-0 items-center select-none"
      title={
        usage
          ? formatTurnUsageTitle(usage)
          : usageMissing
            ? TURN_USAGE_MISSING_TITLE
            : undefined
      }
    >
      <TurnMetaRule kind="actions" lead={false} />
      {usageMissing ? (
        <span className="text-[13px] leading-none text-text-faint">
          {TURN_USAGE_MISSING_LABEL}
        </span>
      ) : null}
      {usageSplit ? (
        <span className="inline-flex shrink-0 items-center gap-2.5 text-[13px] leading-none text-text-subtle">
          <span className="sr-only">本轮消耗</span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <TurnUsageArrow direction="in" />
            <span>{usageSplit.input}</span>
          </span>
          <span className="inline-flex items-center gap-1 tabular-nums">
            <TurnUsageArrow direction="out" />
            <span>{usageSplit.output}</span>
          </span>
        </span>
      ) : null}
      {modelLabel && (usageSplit || usageMissing) ? <TurnMetaRule kind="model" /> : null}
      {modelLabel ? (
        <span
          data-turn-model-chip=""
          className="inline-flex h-5 min-w-0 max-w-[13rem] items-center gap-1 truncate rounded-md bg-surface-card-strong pr-1 text-[13px] leading-none text-text-subtle"
          title={modelLabel}
        >
          {isAuto ? <span className="shrink-0 text-text-faint">auto</span> : null}
          <span className="truncate">{bareModel}</span>
        </span>
      ) : null}
    </span>
  );
}
