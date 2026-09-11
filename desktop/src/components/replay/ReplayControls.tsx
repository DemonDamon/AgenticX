import {
  Clipboard,
  Pause,
  Play,
  SkipBack,
  SkipForward,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ReplayFilter, ReplaySpeed } from "./replay-types";

type Props = {
  playing: boolean;
  speed: ReplaySpeed;
  filters: ReadonlySet<string>;
  canStepBack: boolean;
  canStepForward: boolean;
  copying: boolean;
  copyFeedback: string | null;
  onTogglePlay: () => void;
  onStep: (direction: -1 | 1) => void;
  onSpeedChange: (speed: ReplaySpeed) => void;
  onFiltersChange: (filters: Set<ReplayFilter>) => void;
  onCopy: () => void;
  presenting?: boolean;
  canPresent?: boolean;
  presentBlockedReason?: string;
  onTogglePresent?: () => void;
};

const FILTERS: ReplayFilter[] = ["all", "tool", "agent", "wait", "error", "artifact"];
const SPEEDS: ReplaySpeed[] = [0.5, 1, 2, "instant"];
const PRESENT_SPEEDS: ReplaySpeed[] = [1, 2, "instant"];

export function ReplayControls({
  playing,
  speed,
  filters,
  canStepBack,
  canStepForward,
  copying,
  copyFeedback,
  onTogglePlay,
  onStep,
  onSpeedChange,
  onFiltersChange,
  onCopy,
  presenting = false,
  canPresent = false,
  presentBlockedReason,
  onTogglePresent,
}: Props) {
  const { t } = useTranslation("workspace");
  const toggleFilter = (filter: ReplayFilter) => {
    if (filter === "all") {
      onFiltersChange(new Set(["all"]));
      return;
    }
    const next = new Set<ReplayFilter>(
      [...filters].filter((item): item is ReplayFilter => FILTERS.includes(item as ReplayFilter)),
    );
    next.delete("all");
    if (next.has(filter)) next.delete(filter);
    else next.add(filter);
    onFiltersChange(next.size ? next : new Set(["all"]));
  };

  const buttonClass =
    "inline-flex h-7 items-center justify-center rounded-md px-2 text-[11px] text-text-muted transition hover:bg-surface-hover hover:text-text-strong disabled:cursor-default disabled:opacity-40";

  return (
    <div className="shrink-0 space-y-1.5 border-b border-border bg-surface-panel px-3 py-2">
      <div className="flex flex-wrap items-center gap-1">
        <button
          type="button"
          className={buttonClass}
          aria-label={t("replay.previous")}
          disabled={!canStepBack}
          onClick={() => onStep(-1)}
        >
          <SkipBack aria-hidden className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className={`${buttonClass} bg-surface-card-strong text-text-strong`}
          aria-label={playing ? t("replay.pause") : t("replay.play")}
          onClick={onTogglePlay}
        >
          {playing
            ? <Pause aria-hidden className="mr-1 h-3.5 w-3.5" />
            : <Play aria-hidden className="mr-1 h-3.5 w-3.5" />}
          {playing ? t("replay.pause") : t("replay.play")}
        </button>
        <button
          type="button"
          className={buttonClass}
          aria-label={t("replay.next")}
          disabled={!canStepForward}
          onClick={() => onStep(1)}
        >
          <SkipForward aria-hidden className="h-3.5 w-3.5" />
        </button>
        {onTogglePresent ? (
          <button
            type="button"
            className={`${buttonClass} ${
              presenting
                ? "bg-status-warning/15 text-status-warning"
                : "bg-surface-card-strong text-text-strong"
            }`}
            aria-label={presenting ? t("replay.exitPresent") : t("replay.present")}
            aria-pressed={presenting}
            disabled={!presenting && !canPresent}
            title={!presenting && presentBlockedReason ? presentBlockedReason : undefined}
            onClick={onTogglePresent}
          >
            {presenting ? t("replay.exitPresent") : t("replay.present")}
          </button>
        ) : null}
        <label className="ml-1">
          <span className="sr-only">{t("replay.speed")}</span>
          <select
            aria-label={t("replay.speed")}
            className="h-7 rounded-md border border-border bg-surface-card px-2 text-[11px] text-text-muted outline-none focus:border-border-strong"
            value={String(speed)}
            onChange={(event) => {
              const value = event.target.value;
              onSpeedChange(value === "instant" ? "instant" : Number(value) as 0.5 | 1 | 2);
            }}
          >
            {(presenting ? PRESENT_SPEEDS : SPEEDS).map((item) => (
              <option key={String(item)} value={String(item)}>
                {item === "instant" ? t("replay.instant") : `${item}×`}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className={buttonClass}
            disabled={copying}
            onClick={onCopy}
          >
            <Clipboard aria-hidden className="mr-1 h-3.5 w-3.5" />
            {t("replay.copyReview")}
          </button>
          {copyFeedback ? (
            <span className="text-[10px] text-text-muted" role="status">{copyFeedback}</span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap gap-1" aria-label={t("replay.title")}>
        {FILTERS.map((filter) => {
          const active = filters.has(filter);
          return (
            <button
              key={filter}
              type="button"
              aria-pressed={active}
              className={`rounded-full px-2 py-0.5 text-[10px] transition ${
                active
                  ? "bg-surface-card-strong text-text-strong"
                  : "text-text-faint hover:bg-surface-hover hover:text-text-muted"
              }`}
              onClick={() => toggleFilter(filter)}
            >
              {t(`replay.${filter}`)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
