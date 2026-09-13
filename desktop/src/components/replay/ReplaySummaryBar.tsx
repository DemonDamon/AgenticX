import { ChevronDown } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatDuration } from "../graph/span-derive";
import { canOfferSessionPlay, SESSION_PLAY_ID } from "./replay-session-play";
import type { ReplayRun, ReplayStats } from "./replay-types";

type Props = {
  runs: ReplayRun[];
  selectedRunId: string;
  stats: ReplayStats;
  summarizing: boolean;
  onSelectRun: (runId: string) => void;
};

function statusTone(status: ReplayRun["status"]): string {
  if (status === "completed") return "text-status-success";
  if (status === "failed") return "text-status-error";
  if (status === "running") return "text-text-primary";
  return "text-status-warning";
}

export function replayIntlLocale(language: string | undefined): "zh-CN" | "en-US" {
  return language?.toLowerCase().startsWith("zh") ? "zh-CN" : "en-US";
}

export function ReplaySummaryBar({
  runs,
  selectedRunId,
  stats,
  summarizing,
  onSelectRun,
}: Props) {
  const { t, i18n } = useTranslation("workspace");
  const locale = replayIntlLocale(i18n.resolvedLanguage || i18n.language);
  const sessionPlay = selectedRunId === SESSION_PLAY_ID;
  const offerSessionPlay = canOfferSessionPlay(runs);
  const selected = sessionPlay
    ? undefined
    : runs.find((run) => run.runId === selectedRunId) ?? runs[0];
  if (!sessionPlay && !selected) return null;
  const metrics = [
    [t("replay.duration"), formatDuration(stats.durationMs)],
    [t("replay.rounds"), stats.rounds],
    [t("replay.toolCalls"), stats.toolCalls],
    [t("replay.errors"), stats.errors],
    [t("replay.subagents"), stats.subagents],
    [t("replay.branches"), stats.branches],
  ];

  return (
    <div className="shrink-0 border-b border-border bg-surface-panel px-3 py-2">
      <div className="flex min-w-0 items-center gap-2">
        {runs.length > 1 ? (
          <label className="relative min-w-0">
            <span className="sr-only">{t("replay.runPicker")}</span>
            <select
              aria-label={t("replay.runPicker")}
              className="h-7 max-w-[210px] appearance-none rounded-md border border-border bg-surface-card py-1 pl-2 pr-7 text-[11px] text-text-strong outline-none focus:border-border-strong"
              value={sessionPlay ? SESSION_PLAY_ID : selected!.runId}
              onChange={(event) => onSelectRun(event.target.value)}
            >
              {offerSessionPlay ? (
                <option value={SESSION_PLAY_ID}>{t("replay.sessionPlay")}</option>
              ) : null}
              {runs.map((run) => (
                <option key={run.runId} value={run.runId}>
                  {t(`replay.${run.status}`)} · {new Date(run.createdAt).toLocaleString(locale)}
                </option>
              ))}
            </select>
            <ChevronDown
              aria-hidden
              className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-text-faint"
            />
          </label>
        ) : (
          <span className={`text-[11px] font-medium ${statusTone(selected!.status)}`}>
            {t(`replay.${selected!.status}`)}
          </span>
        )}
        {selected?.completeness === "partial" ? (
          <span className="rounded-full bg-status-warning/10 px-2 py-0.5 text-[10px] text-status-warning">
            {t("replay.recordPartial")}
          </span>
        ) : null}
      </div>
      {summarizing ? (
        <div className="mt-1.5 text-[10px] text-text-faint">{t("replay.summarizing")}</div>
      ) : (
        <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-faint">
          {metrics.map(([label, value]) => (
            <span key={String(label)}>
              {label} <strong className="font-medium text-text-muted">{value}</strong>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
