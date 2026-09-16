import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatReplayEventLabel } from "./replay-event-label";
import {
  formatCausalChainMarkdown,
  type CausalChain,
  type CausalHopReason,
} from "./replay-causal-chain";
import type { ReplayEvent } from "./replay-types";

type Props = {
  chain: CausalChain;
  events: ReplayEvent[];
  onCopyChain?: (markdown: string) => Promise<void>;
  onSelectChainEvent?: (eventId: string) => void;
};

const HOP_REASONS: CausalHopReason[] = [
  "parent_event",
  "tool_call_id",
  "wait_pair",
  "path_in_tool_input",
  "failed_result_to_error",
];

function eventTitle(event: ReplayEvent, label: string): string {
  return event.title && event.title !== event.type ? event.title : label;
}

export function ReplayCausalChain({
  chain,
  events,
  onCopyChain,
  onSelectChainEvent,
}: Props) {
  const { t } = useTranslation("workspace");
  const [feedback, setFeedback] = useState<string | null>(null);
  const feedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const byId = new Map(events.map((event) => [event.eventId, event]));

  if (chain.eventIds.length === 0) return null;

  const copyChain = async () => {
    if (!onCopyChain) return;
    const reasons = Object.fromEntries(
      HOP_REASONS.map((reason) => [reason, t(`replay.chainReason.${reason}`)]),
    ) as Record<CausalHopReason, string>;
    const markdown = formatCausalChainMarkdown(chain, events, {
      heading: t("replay.chain"),
      recorded: t("replay.chainKind.recorded"),
      inferred: t("replay.chainKind.inferred"),
      reasons,
      note: t("replay.chainLegend"),
    });
    try {
      await onCopyChain(markdown);
      setFeedback(t("replay.chainCopied"));
    } catch (error) {
      setFeedback(
        `${t("replay.chainCopyFailed")}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    if (feedbackTimer.current) clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), 1_600);
  };

  return (
    <div className="mt-3">
      <div className="flex items-baseline justify-between gap-2">
        <h4 className="text-[9px] uppercase tracking-wide text-text-faint">{t("replay.chain")}</h4>
        {chain.hops.length > 0 ? (
          <span className="text-[9px] text-text-faint">
            {t("replay.chainSteps", { count: chain.eventIds.length })}
            {chain.inferredCount > 0
              ? ` · ${t("replay.chainInferred", { count: chain.inferredCount })}`
              : ""}
          </span>
        ) : null}
      </div>
      {chain.hops.length === 0 ? (
        <p className="mt-1 text-[10px] leading-relaxed text-text-faint">{t("replay.chainEmpty")}</p>
      ) : (
        <ol className="mt-1.5">
          {chain.eventIds.map((eventId, index) => {
            const event = byId.get(eventId);
            if (!event) return null;
            const hop = index < chain.hops.length ? chain.hops[index] : undefined;
            const isTarget = eventId === chain.targetEventId;
            const label = eventTitle(event, formatReplayEventLabel(event.type, t));
            return (
              <li key={eventId}>
                <button
                  type="button"
                  className={`flex w-full items-baseline gap-1.5 rounded-md px-1 py-0.5 text-left hover:bg-surface-hover ${
                    isTarget ? "font-medium text-text-strong" : "text-text-muted"
                  }`}
                  onClick={() => onSelectChainEvent?.(eventId)}
                >
                  <span className="font-mono text-[10px] text-text-faint">#{event.seq}</span>
                  <span className="min-w-0 truncate text-[10px]">{label}</span>
                </button>
                {hop ? (
                  <div
                    className={`ml-2 border-l px-2 py-0.5 text-[9px] ${
                      hop.kind === "inferred"
                        ? "border-dashed border-status-warning text-status-warning"
                        : "border-border text-text-faint"
                    }`}
                  >
                    {t(`replay.chainKind.${hop.kind}`)}
                    {" · "}
                    {t(`replay.chainReason.${hop.reason}`)}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
      {chain.hops.length > 0 && onCopyChain ? (
        <button
          type="button"
          className="mt-2 inline-flex items-center rounded-md bg-surface-hover px-2 py-1 text-[10px] text-text-muted hover:bg-surface-card-strong hover:text-text-strong"
          onClick={() => void copyChain()}
        >
          {t("replay.chainCopy")}
        </button>
      ) : null}
      {feedback ? (
        <p className="mt-1 text-[9px] text-text-faint">{feedback}</p>
      ) : null}
      {chain.inferredCount > 0 ? (
        <p className="mt-1.5 text-[9px] leading-relaxed text-text-faint">{t("replay.chainLegend")}</p>
      ) : null}
    </div>
  );
}
