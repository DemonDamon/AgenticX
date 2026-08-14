"use client";

import * as React from "react";
import type { ChatMessageDeepResearch, DeepResearchEvent } from "@agenticx/core-api";
import { DeepResearchClarifyCard } from "./DeepResearchClarifyCard";
import {
  buildDeepResearchSegments,
  deepResearchNeedsTrailingActivity,
  deepResearchWaitingLabel,
} from "./deep-research-segments";
import type { ResearchStep } from "./deep-research-steps";
import {
  laneSourceHost,
  parseLaneMetrics,
  type LaneSource,
} from "./deep-research-lane-sources";
import { WebSearchFavicon } from "./WebSearchFavicon";

/** A lane plus the pages it searched, handed to the docked source panel. */
export type DeepResearchLaneSelection = { title: string; sources: LaneSource[] };

export type DeepResearchWorkbenchProps = {
  deepResearch: ChatMessageDeepResearch;
  onClarifySubmitted?: (answers: Record<string, string>) => void;
  /** Intermediate lane memos via expandable step "查看产物". */
  onOpenArtifact?: (artifactId: string) => void;
  /** Open the docked panel on every page this lane searched. */
  onOpenLaneSources?: (lane: DeepResearchLaneSelection) => void;
  /** Open a single searched page. */
  onOpenLaneSource?: (source: LaneSource) => void;
  className?: string;
};

/** Inline lane preview stays short; the rest lives in the docked panel. */
const INLINE_SOURCE_LIMIT = 4;

function IconSearch({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

function IconCheck({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m9 11 3 3L22 4" />
    </svg>
  );
}

function IconSpinner({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

function IconChevronRight({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function LaneSourceRow({
  source,
  onOpen,
}: {
  source: LaneSource;
  onOpen?: (source: LaneSource) => void;
}) {
  const host = laneSourceHost(source.url);
  return (
    <button
      type="button"
      onClick={() => onOpen?.(source)}
      disabled={!onOpen}
      className={[
        "flex w-full items-center gap-2 rounded-lg px-1.5 py-1.5 text-left",
        onOpen ? "transition-colors hover:bg-muted/60" : "cursor-default",
      ].join(" ")}
      data-testid="deep-research-lane-source"
    >
      <WebSearchFavicon host={host} label={source.title} size={16} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] leading-5 text-foreground">
          {source.title || source.url}
        </span>
        <span className="block truncate text-[11px] leading-4 text-muted-foreground">
          {host}
          {source.fetched ? " · 已读取" : ""}
        </span>
      </span>
    </button>
  );
}

function ExpandableStepRow({
  step,
  showRail,
  onOpenArtifact,
  onOpenLaneSources,
  onOpenLaneSource,
}: {
  step: ResearchStep;
  showRail: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  onOpenLaneSources?: (lane: DeepResearchLaneSelection) => void;
  onOpenLaneSource?: (source: LaneSource) => void;
}) {
  const sources = step.sources ?? [];
  const metrics = React.useMemo(
    () => parseLaneMetrics(step.detailLines),
    [step.detailLines],
  );
  // Metrics render inline below the row, so they alone are not a reason to expand.
  const canExpand =
    sources.length > 0 ||
    Boolean(step.artifactId) ||
    (metrics.length === 0 && step.detailLines.length > 0);
  const autoOpen = step.kind === "phase" && step.status === "running" && canExpand;
  const [open, setOpen] = React.useState(autoOpen);
  const previousStatus = React.useRef(step.status);
  const previousCanExpand = React.useRef(canExpand);

  React.useEffect(() => {
    if (
      step.kind === "phase" &&
      step.status === "running" &&
      canExpand &&
      (previousStatus.current !== "running" || !previousCanExpand.current)
    ) {
      setOpen(true);
    } else if (previousStatus.current === "running" && step.status !== "running") {
      setOpen(false);
    }
    previousStatus.current = step.status;
    previousCanExpand.current = canExpand;
  }, [canExpand, step.kind, step.status]);

  return (
    <li className="relative">
      {showRail ? (
        <span
          aria-hidden
          className="absolute left-[7px] top-6 bottom-0 w-px border-l border-dotted border-border/80"
        />
      ) : null}
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => {
          if (!canExpand) return;
          setOpen((v) => !v);
        }}
        className={[
          "flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-left text-sm leading-5 transition-colors",
          canExpand ? "hover:bg-muted/60" : "cursor-default",
          step.status === "running" ? "bg-muted/45" : "",
          step.status === "failed" ? "text-destructive" : "text-foreground",
        ].join(" ")}
      >
        <span className="relative z-[1] mt-0.5 flex h-4 w-4 items-center justify-center">
          {step.status === "running" ? (
            <IconSpinner className="h-4 w-4 animate-spin text-primary" />
          ) : step.kind === "lane" ? (
            <IconSearch
              className={[
                "h-4 w-4",
                step.status === "failed" ? "text-destructive" : "text-muted-foreground",
              ].join(" ")}
            />
          ) : (
            <IconCheck
              className={[
                "h-4 w-4",
                step.status === "failed" ? "text-destructive" : "text-muted-foreground",
              ].join(" ")}
            />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="font-medium">{step.title}</span>
          {step.subtitle ? (
            <span className="text-muted-foreground"> | {step.subtitle}</span>
          ) : null}
        </span>
        {canExpand ? (
          <IconChevronRight
            className={[
              "mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open ? "rotate-90" : "",
            ].join(" ")}
          />
        ) : null}
      </button>
      {metrics.length > 0 ? (
        <div
          className="mb-1 ml-6 flex flex-wrap gap-1.5 px-1.5"
          data-testid="deep-research-lane-metrics"
        >
          {metrics.map((metric) => (
            <span
              key={`${step.id}-m-${metric.key}`}
              className={[
                "rounded-full px-2 py-0.5 text-[11px] leading-4",
                metric.tone === "warning"
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "bg-muted/70 text-foreground/75",
              ].join(" ")}
            >
              {metric.text}
            </span>
          ))}
        </div>
      ) : null}
      {open && canExpand ? (
        <div className="mb-1 ml-7 space-y-2 rounded-md border border-border/40 bg-background/80 px-2.5 py-2 text-sm leading-5 text-muted-foreground">
          {metrics.length === 0
            ? step.detailLines.map((line, i) => (
                <p key={`${step.id}-d-${i}`} className="whitespace-pre-wrap">
                  {line}
                </p>
              ))
            : null}
          {sources.length > 0 ? (
            <div className="space-y-0.5">
              {sources.slice(0, INLINE_SOURCE_LIMIT).map((source, i) => (
                <LaneSourceRow
                  key={`${step.id}-s-${i}`}
                  source={source}
                  onOpen={onOpenLaneSource}
                />
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-3 text-[13px]">
            {sources.length > 0 && onOpenLaneSources ? (
              <button
                type="button"
                className="text-primary hover:underline"
                data-testid="deep-research-lane-sources-all"
                onClick={() =>
                  onOpenLaneSources({
                    title: step.subtitle ?? step.title,
                    sources,
                  })
                }
              >
                查看全部 {sources.length} 个来源
              </button>
            ) : null}
            {step.artifactId && onOpenArtifact ? (
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => onOpenArtifact(step.artifactId!)}
              >
                查看产物
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </li>
  );
}

function ToolsCard({
  title,
  steps,
  onOpenArtifact,
  onOpenLaneSources,
  onOpenLaneSource,
}: {
  title: string;
  steps: ResearchStep[];
  onOpenArtifact?: (artifactId: string) => void;
  onOpenLaneSources?: (lane: DeepResearchLaneSelection) => void;
  onOpenLaneSource?: (source: LaneSource) => void;
}) {
  const running = steps.some((s) => s.status === "running");
  // In-progress: keep open; completed: default collapsed so the long lane list does not dominate.
  const [open, setOpen] = React.useState(running);
  const prevRunning = React.useRef(running);

  React.useEffect(() => {
    if (prevRunning.current && !running) {
      setOpen(false);
    } else if (!prevRunning.current && running) {
      setOpen(true);
    }
    prevRunning.current = running;
  }, [running]);

  return (
    <div
      className="mb-3 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm"
      data-testid="deep-research-tools-card"
      data-collapsed={open ? "false" : "true"}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        {running ? (
          <IconSpinner className="h-4 w-4 shrink-0 animate-spin text-primary" />
        ) : (
          <IconCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{title}</span>
        <IconChevronRight
          className={[
            "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open ? "rotate-90" : "",
          ].join(" ")}
        />
      </button>
      {open ? (
        <div className="border-t border-border/50 px-3 py-2">
          {steps.length > 0 ? (
            <ol className="relative space-y-0.5">
              {steps.map((step, index) => (
                <ExpandableStepRow
                  key={step.id}
                  step={step}
                  showRail={index < steps.length - 1}
                  onOpenArtifact={onOpenArtifact}
                  onOpenLaneSources={onOpenLaneSources}
                  onOpenLaneSource={onOpenLaneSource}
                />
              ))}
            </ol>
          ) : (
            <div className="text-sm leading-5 text-muted-foreground">准备检索…</div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StatusRow({
  title,
  status,
  detailLines,
}: {
  title: string;
  status: "running" | "done" | "failed";
  detailLines: string[];
}) {
  const running = status === "running";
  const canExpand = detailLines.length > 0;
  const [open, setOpen] = React.useState(running && canExpand);
  const prevRunning = React.useRef(running);

  React.useEffect(() => {
    if (prevRunning.current && !running) {
      setOpen(false);
    } else if (!prevRunning.current && running && canExpand) {
      setOpen(true);
    }
    prevRunning.current = running;
  }, [canExpand, running]);

  return (
    <div
      className="mb-3 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm"
      data-testid="deep-research-status-row"
      data-collapsed={open ? "false" : "true"}
    >
      <button
        type="button"
        disabled={!canExpand}
        onClick={() => {
          if (canExpand) setOpen((value) => !value);
        }}
        className={[
          "flex w-full items-center gap-2 px-3 py-2.5 text-left",
          canExpand ? "" : "cursor-default",
        ].join(" ")}
        aria-expanded={canExpand ? open : undefined}
      >
        {status === "running" ? (
          <IconSpinner className="h-4 w-4 shrink-0 animate-spin text-primary" />
        ) : status === "failed" ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-destructive" />
        ) : (
          <IconCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
        )}
        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{title}</span>
        {canExpand ? (
          <IconChevronRight
            className={[
              "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              open ? "rotate-90" : "",
            ].join(" ")}
          />
        ) : null}
      </button>
      {open && canExpand ? (
        <div className="space-y-1 border-t border-border/50 px-3 py-2 text-sm leading-5 text-muted-foreground">
          {detailLines.map((line, index) => (
            <p key={`${title}-detail-${index}`} className="whitespace-pre-wrap">
              {line}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ReflectionCard({ gaps }: { gaps: string[] }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div
      className="mb-3 overflow-hidden rounded-xl border border-border/60 bg-card shadow-sm"
      data-testid="deep-research-reflection"
      data-collapsed={open ? "false" : "true"}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left"
        aria-expanded={open}
      >
        <IconCheck className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">
          发现 {gaps.length} 处信息缺口
        </span>
        <IconChevronRight
          className={[
            "ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform",
            open ? "rotate-90" : "",
          ].join(" ")}
        />
      </button>
      {open ? (
        <ul className="list-disc space-y-1 border-t border-border/50 px-3 py-2 pl-8 text-sm leading-5 text-muted-foreground">
          {gaps.map((gap, i) => (
            <li key={`gap-${i}`}>{gap}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Same cadence as MessageList ThinkingDotsPlaceholder — keeps deep-research gaps alive. */
function TrailingThinkingDots() {
  return (
    <div
      className="mb-1 inline-flex min-h-[32px] items-center gap-2 py-1"
      data-testid="deep-research-trailing-dots"
      aria-label="深度调研进行中"
    >
      <span className="agx-thinking-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/70" />
      <span className="agx-thinking-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/70 [animation-delay:160ms]" />
      <span className="agx-thinking-dot h-2.5 w-2.5 rounded-full bg-muted-foreground/70 [animation-delay:320ms]" />
    </div>
  );
}

export function DeepResearchWorkbench({
  deepResearch,
  onClarifySubmitted,
  onOpenArtifact,
  onOpenLaneSources,
  onOpenLaneSource,
  className,
}: DeepResearchWorkbenchProps) {
  const segments = React.useMemo(
    () => buildDeepResearchSegments(deepResearch.events, deepResearch.status),
    [deepResearch.events, deepResearch.status],
  );

  // clarify / plan phases render no segment, so events alone can't tell whether the
  // user sees anything — keep the spinner until a real segment lands.
  const waitingShell =
    segments.length === 0 &&
    (deepResearch.status === "running" || deepResearch.status === "awaiting_clarify");

  const timedOut = deepResearch.events.some((e) => e.type === "clarify_timeout");
  const hasClarify = deepResearch.events.some((e): e is Extract<DeepResearchEvent, { type: "clarify" }> =>
    e.type === "clarify",
  );
  const showTrailingDots = deepResearchNeedsTrailingActivity(segments, deepResearch.status);

  if (waitingShell) {
    return (
      <div className={["mb-3 text-sm leading-5 text-foreground", className].filter(Boolean).join(" ")}>
        <div className="flex items-center gap-2">
          <IconSpinner className="h-4 w-4 animate-spin text-primary" />
          <span>{deepResearchWaitingLabel(deepResearch.events)}</span>
        </div>
      </div>
    );
  }

  if (segments.length === 0 && !hasClarify) return null;

  return (
    <div className={className} data-testid="deep-research-workbench">
      {segments.map((segment) => {
        switch (segment.kind) {
          case "narrative":
            return (
              <p
                key={segment.id}
                className="mb-3 text-sm leading-6 text-foreground"
                data-testid="deep-research-narrative"
              >
                {segment.text}
              </p>
            );
          case "clarify":
            return (
              <DeepResearchClarifyCard
                key={segment.id}
                events={deepResearch.events}
                awaiting={deepResearch.status === "awaiting_clarify"}
                clarifyAnswers={deepResearch.clarifyAnswers}
                timedOut={timedOut}
                onSubmitted={onClarifySubmitted}
              />
            );
          case "tools":
            return (
              <ToolsCard
                key={segment.id}
                title={segment.title}
                steps={segment.steps}
                onOpenArtifact={onOpenArtifact}
                onOpenLaneSources={onOpenLaneSources}
                onOpenLaneSource={onOpenLaneSource}
              />
            );
          case "status":
            return (
              <StatusRow
                key={segment.id}
                title={segment.title}
                status={segment.status}
                detailLines={segment.detailLines}
              />
            );
          case "reflection":
            return <ReflectionCard key={segment.id} gaps={segment.gaps} />;
          case "stats":
            return (
              <p
                key={segment.id}
                className="mb-3 text-xs leading-5 text-muted-foreground"
                data-testid="deep-research-stats"
              >
                {segment.label}
              </p>
            );
          default: {
            const _exhaustive: never = segment;
            return _exhaustive;
          }
        }
      })}
      {showTrailingDots ? <TrailingThinkingDots /> : null}
    </div>
  );
}
