import { ExternalLink, FileText, GitBranch, LoaderCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatToolDisplayName } from "../messages/tool-display-name";
import { ReplayCausalChain } from "./ReplayCausalChain";
import type { CausalChain } from "./replay-causal-chain";
import { formatReplayEventLabel } from "./replay-event-label";
import type { ReplayPayloadDisplay } from "./replay-payload";
import type { EffectClass, ReplayEvent } from "./replay-types";

type Props = {
  event: ReplayEvent | null;
  payloadDisplay?: ReplayPayloadDisplay;
  payloadLoading: boolean;
  payloadError: string | null;
  onLoadPayload: (event: ReplayEvent) => void;
  onOpenArtifact?: (path: string) => void;
  onOpenSubagentRun?: (runId: string) => void;
  canBranch?: boolean;
  branchDisabledReason?: string;
  onBranchFromStep?: (event: ReplayEvent) => void;
  chain?: CausalChain | null;
  chainEvents?: ReplayEvent[];
  onCopyChain?: (markdown: string) => Promise<void>;
  onSelectChainEvent?: (eventId: string) => void;
};

function payloadString(payload: Record<string, unknown> | undefined, keys: string[]): string {
  for (const key of keys) {
    const value = payload?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function effectTone(effect: EffectClass): string {
  if (effect === "external_write" || effect === "unknown") {
    return "bg-status-warning/10 text-status-warning";
  }
  if (effect === "local_write") return "bg-surface-card-strong text-text-primary";
  return "bg-surface-hover text-text-muted";
}

export function ReplayEventDetail({
  event,
  payloadDisplay,
  payloadLoading,
  payloadError,
  onLoadPayload,
  onOpenArtifact,
  onOpenSubagentRun,
  canBranch = false,
  branchDisabledReason,
  onBranchFromStep,
  chain,
  chainEvents,
  onCopyChain,
  onSelectChainEvent,
}: Props) {
  const { t } = useTranslation("workspace");
  if (!event) {
    return (
      <aside className="w-[min(34%,280px)] shrink-0 border-l border-border bg-surface-card px-3 py-3">
        <h3 className="text-[11px] font-medium text-text-strong">{t("replay.eventDetail")}</h3>
        <p className="mt-2 text-[10px] leading-relaxed text-text-faint">{t("replay.selectEvent")}</p>
      </aside>
    );
  }
  const toolName = payloadDisplay?.toolName
    || payloadString(event.payload, ["name", "tool_name"]);
  const artifactPath = payloadDisplay?.artifactPath
    || payloadString(event.payload, ["path", "artifact_path", "output_path"]);
  const subagentRunId = payloadDisplay?.subagentRunId
    || payloadString(event.payload, ["run_id", "subagent_run_id"]);
  const payloadText = payloadDisplay?.displayText || event.payloadPreviewText || "";
  const payloadTruncated = payloadDisplay?.truncated || event.payloadPreviewTruncated === true;
  const eventLabel = formatReplayEventLabel(event.type, t);
  const eventTitle = event.title && event.title !== event.type ? event.title : eventLabel;
  const effectKey: Record<EffectClass, string> = {
    none: "effectNone",
    read: "effectRead",
    local_write: "effectLocalWrite",
    external_write: "effectExternalWrite",
    unknown: "effectUnknown",
  };

  return (
    <aside className="w-[min(36%,300px)] shrink-0 overflow-y-auto border-l border-border bg-surface-card px-3 py-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[11px] font-medium text-text-strong">{t("replay.eventDetail")}</h3>
        <span className="font-mono text-[10px] text-text-faint">#{event.seq}</span>
      </div>
      <p className="mt-2 break-words text-[12px] font-medium text-text-strong">
        {toolName ? formatToolDisplayName(toolName) : eventTitle}
      </p>
      {event.summary ? (
        <p className="mt-1 whitespace-pre-wrap break-words text-[10px] leading-relaxed text-text-muted">
          {event.summary}
        </p>
      ) : null}
      <div className="mt-3">
        <span className="text-[9px] uppercase tracking-wide text-text-faint">{t("replay.effect")}</span>
        <div className="mt-1">
          <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] ${effectTone(event.effectClass)}`}>
            {t(`replay.${effectKey[event.effectClass]}`)}
          </span>
        </div>
        {event.effectClass === "unknown" ? (
          <p className="mt-1 text-[9px] leading-relaxed text-status-warning">
            {t("replay.effectUnknownHint")}
          </p>
        ) : null}
      </div>
      {chain && chain.eventIds.length > 0 ? (
        <ReplayCausalChain
          chain={chain}
          events={chainEvents ?? []}
          onCopyChain={onCopyChain}
          onSelectChainEvent={onSelectChainEvent}
        />
      ) : null}
      {payloadText ? (
        <details className="mt-3 rounded-md bg-surface-panel">
          <summary className="cursor-pointer px-2 py-1.5 text-[10px] text-text-muted hover:text-text-strong">
            {t("replay.payloadPreview")}
          </summary>
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words border-t border-border px-2 py-2 font-mono text-[9px] leading-relaxed text-text-muted">
            {payloadText}
          </pre>
          {payloadTruncated ? (
            <p className="border-t border-border px-2 py-1 text-[9px] text-status-warning">
              {t("replay.payloadTruncated")}
            </p>
          ) : null}
        </details>
      ) : null}
      {event.payloadRef && !payloadDisplay ? (
        <div className="mt-2">
          <button
            type="button"
            className="inline-flex items-center rounded-md bg-surface-hover px-2 py-1 text-[10px] text-text-muted hover:bg-surface-card-strong hover:text-text-strong disabled:opacity-50"
            disabled={payloadLoading}
            onClick={() => onLoadPayload(event)}
          >
            {payloadLoading ? <LoaderCircle aria-hidden className="mr-1 h-3 w-3 animate-spin" /> : null}
            {payloadLoading ? t("replay.payloadLoading") : t("replay.viewPayload")}
          </button>
          {payloadError ? (
            <p className="mt-1 break-words text-[9px] text-status-error">{payloadError}</p>
          ) : null}
        </div>
      ) : null}
      {artifactPath && onOpenArtifact ? (
        <button
          type="button"
          className="mt-3 flex w-full items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1.5 text-left text-[10px] text-text-muted hover:bg-surface-card-strong hover:text-text-strong"
          onClick={() => onOpenArtifact(artifactPath)}
        >
          <FileText aria-hidden className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1 truncate">{t("replay.openArtifact")}</span>
          <ExternalLink aria-hidden className="h-3 w-3" />
        </button>
      ) : null}
      {subagentRunId && onOpenSubagentRun ? (
        <button
          type="button"
          className="mt-2 flex w-full items-center gap-1.5 rounded-md bg-surface-hover px-2 py-1.5 text-left text-[10px] text-text-muted hover:bg-surface-card-strong hover:text-text-strong"
          onClick={() => onOpenSubagentRun(subagentRunId)}
        >
          <GitBranch aria-hidden className="h-3.5 w-3.5 shrink-0" />
          {t("replay.openSubagent")}
        </button>
      ) : null}
      {onBranchFromStep ? (
        <button
          type="button"
          className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-2 text-[11px] text-[var(--ui-btn-primary-text)] hover:bg-[var(--ui-btn-primary-hover)] disabled:cursor-not-allowed disabled:opacity-45"
          disabled={!canBranch}
          onClick={() => onBranchFromStep(event)}
        >
          <GitBranch aria-hidden className="h-3.5 w-3.5" />
          {t("replay.branchFromBefore", "从此前分叉")}
        </button>
      ) : null}
      {!canBranch && branchDisabledReason ? (
        <div className="mt-3 rounded-md bg-surface-hover px-2 py-1.5 text-[9px] text-text-faint">
          {t("replay.cannotBranch")}
          {" · "}
          {t(`replay.branchReason.${branchDisabledReason}`, {
            defaultValue: branchDisabledReason,
          })}
        </div>
      ) : null}
    </aside>
  );
}
