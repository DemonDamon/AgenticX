import { CircleAlert, Clock3 } from "lucide-react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { Avatar } from "../../store";
import { avatarDotColorForIdentity } from "../../utils/avatar-color";
import { formatDuration } from "../graph/span-derive";
import { formatReplayEventLabel } from "./replay-event-label";
import { projectReplay } from "./replay-projection";
import type { ReplayEvent, ReplaySpan } from "./replay-types";

type ReplayKeyEvent = {
  key: string;
  target: unknown;
  preventDefault: () => void;
};

type ReplayKeyActions = {
  toggle: () => void;
  step: (direction: -1 | 1) => void;
  seekFirst: () => void;
  seekLast: () => void;
};

function isEditableTarget(target: unknown): boolean {
  if (!target || typeof target !== "object") return false;
  const raw = target as { tagName?: unknown; isContentEditable?: unknown };
  const tagName = typeof raw.tagName === "string" ? raw.tagName.toUpperCase() : "";
  return raw.isContentEditable === true
    || tagName === "BUTTON"
    || tagName === "A"
    || tagName === "INPUT"
    || tagName === "TEXTAREA"
    || tagName === "SELECT";
}

export function handleReplayKeyDown(event: ReplayKeyEvent, actions: ReplayKeyActions): void {
  if (isEditableTarget(event.target)) return;
  if (event.key === " " || event.key === "Spacebar") {
    event.preventDefault();
    actions.toggle();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    actions.step(-1);
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    actions.step(1);
  } else if (event.key === "Home") {
    event.preventDefault();
    actions.seekFirst();
  } else if (event.key === "End") {
    event.preventDefault();
    actions.seekLast();
  }
}

type Props = {
  events: ReplayEvent[];
  renderLimit?: number;
  rangeFirstSeq: number;
  rangeLastSeq: number;
  rangeFirstTs: number;
  cursorSeq: number;
  selectedEventId: string | null;
  avatarById: Map<string, Avatar>;
  metaLeaderLabel: string;
  onSeek: (seq: number) => void;
  onSelect: (eventId: string) => void;
  onTogglePlay: () => void;
  onStep: (direction: -1 | 1) => void;
  onShowMore?: () => void;
};

function durationForEvent(event: ReplayEvent, spans: ReplaySpan[]): number | null {
  const span = spans.find((item) =>
    item.startEventId === event.eventId || item.endEventId === event.eventId
  );
  return span?.endTs !== undefined ? Math.max(0, span.endTs - span.startTs) : null;
}

function spanForEvent(event: ReplayEvent, spans: ReplaySpan[]): ReplaySpan | undefined {
  return spans.find((item) =>
    item.startEventId === event.eventId || item.endEventId === event.eventId
  );
}

function eventTone(event: ReplayEvent): string {
  if (event.type === "error" || event.type === "ledger_gap" || event.type === "subagent_error") {
    return "text-status-error";
  }
  if (event.type.endsWith("_completed") || event.type === "tool_result") {
    return "text-status-success";
  }
  if (event.type.includes("required") || event.type === "stall") return "text-status-warning";
  return "text-text-faint";
}

export function ReplayTimeline({
  events,
  renderLimit = 500,
  rangeFirstSeq,
  rangeLastSeq,
  rangeFirstTs,
  cursorSeq,
  selectedEventId,
  avatarById,
  metaLeaderLabel,
  onSeek,
  onSelect,
  onTogglePlay,
  onStep,
  onShowMore,
}: Props) {
  const { t } = useTranslation("workspace");
  const cursorEvents = useMemo(
    () => events.filter((event) => event.seq <= cursorSeq),
    [cursorSeq, events],
  );
  const projection = useMemo(() => projectReplay(cursorEvents), [cursorEvents]);
  const firstSeq = rangeFirstSeq;
  const lastSeq = Math.max(rangeFirstSeq, rangeLastSeq);
  const firstTs = rangeFirstTs;
  const laneIndex = useMemo(
    () => new Map(projection.lanes.map((lane, index) => [lane.agentId, index])),
    [projection.lanes],
  );
  const currentEventSeq = useMemo(() => {
    let current: number | null = null;
    for (const event of projection.events) {
      if (event.seq <= cursorSeq && (current === null || event.seq > current)) {
        current = event.seq;
      }
    }
    return current;
  }, [cursorSeq, projection.events]);

  return (
    <div
      className="min-h-0 flex-1 overflow-auto bg-surface-panel outline-none focus-visible:ring-1 focus-visible:ring-border-strong"
      tabIndex={0}
      onKeyDown={(event: ReactKeyboardEvent<HTMLDivElement>) => handleReplayKeyDown(event, {
        toggle: onTogglePlay,
        step: onStep,
        seekFirst: () => onSeek(firstSeq),
        seekLast: () => onSeek(lastSeq),
      })}
    >
      <div className="sticky top-0 z-10 border-b border-border bg-surface-panel px-3 py-2">
        <input
          type="range"
          min={firstSeq}
          max={lastSeq}
          value={Math.min(lastSeq, Math.max(firstSeq, cursorSeq))}
          aria-label={t("replay.scrubberAria")}
          className="h-1.5 w-full cursor-pointer accent-[var(--ui-btn-primary-bg)]"
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        <div className="mt-1 flex items-center justify-between font-mono text-[9px] text-text-faint">
          <span>#{firstSeq}</span>
          <span>#{cursorSeq}</span>
          <span>#{lastSeq}</span>
        </div>
      </div>
      <div className="divide-y divide-border/70">
        {projection.events.slice(0, renderLimit).map((event) => {
          const selected = event.eventId === selectedEventId;
          const current = event.seq === currentEventSeq;
          const avatar = avatarById.get(event.agentId);
          const agentLabel = event.agentId === "meta" ? metaLeaderLabel : avatar?.name || event.agentId;
          const eventLabel = formatReplayEventLabel(event.type, t);
          const eventTitle = event.title && event.title !== event.type ? event.title : eventLabel;
          const duration = durationForEvent(event, projection.spans);
          const span = spanForEvent(event, projection.spans);
          const isProblem = event.type === "error" || event.type === "ledger_gap";
          return (
            <button
              key={event.eventId}
              type="button"
              aria-label={t("replay.stepAria", { seq: event.seq })}
              aria-current={current ? "step" : undefined}
              className={`grid w-full grid-cols-[42px_66px_minmax(62px,90px)_minmax(0,1fr)_auto] items-center gap-2 px-3 py-2 text-left transition ${
                selected
                  ? "bg-surface-card-strong"
                  : current
                    ? "bg-surface-card"
                  : "hover:bg-surface-hover"
              }`}
              onClick={() => onSelect(event.eventId)}
              onKeyDown={(keyboardEvent) => {
                if ([" ", "Spacebar", "Home", "End", "ArrowLeft", "ArrowRight"].includes(
                  keyboardEvent.key,
                )) {
                  keyboardEvent.stopPropagation();
                }
              }}
            >
              <span className="font-mono text-[10px] text-text-faint">#{event.seq}</span>
              <span className="font-mono text-[10px] text-text-faint">
                {t("replay.relativeTime", { time: formatDuration(event.ts - firstTs) })}
              </span>
              <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-text-muted">
                <span
                  aria-hidden
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ backgroundColor: avatarDotColorForIdentity(event.agentId, avatar?.color) }}
                />
                <span className="truncate" title={agentLabel}>
                  {laneIndex.get(event.agentId) !== undefined ? agentLabel : event.agentId}
                </span>
              </span>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5">
                  {isProblem
                    ? <CircleAlert aria-hidden className="h-3.5 w-3.5 shrink-0 text-status-error" />
                    : null}
                  <span className="truncate text-[11px] font-medium text-text-strong">
                    {eventTitle}
                  </span>
                </span>
                {event.summary ? (
                  <span className="mt-0.5 block truncate text-[10px] text-text-faint">
                    {event.summary}
                  </span>
                ) : null}
              </span>
              <span className={`flex items-center gap-1 font-mono text-[9px] ${eventTone(event)}`}>
                {span ? t(`replay.${span.status === "waiting" ? "wait" : span.status}`) : eventLabel}
                {duration !== null ? (
                  <>
                    <Clock3 aria-hidden className="h-3 w-3" />
                    {formatDuration(duration)}
                  </>
                ) : null}
              </span>
            </button>
          );
        })}
      </div>
      {projection.events.length > renderLimit && onShowMore ? (
        <div className="border-t border-border px-3 py-2 text-center">
          <button
            type="button"
            className="rounded-md bg-surface-hover px-3 py-1 text-[10px] text-text-muted hover:bg-surface-card-strong hover:text-text-strong"
            onClick={onShowMore}
          >
            {t("replay.showMoreEvents")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
