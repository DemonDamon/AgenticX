"use client";

import * as React from "react";
import type { ChatMessageDeepResearch, DeepResearchEvent } from "@agenticx/core-api";
import { DeepResearchClarifyCard } from "./DeepResearchClarifyCard";
import { buildDeepResearchSegments } from "./deep-research-segments";
import type { ResearchStep } from "./deep-research-steps";

export type DeepResearchWorkbenchProps = {
  deepResearch: ChatMessageDeepResearch;
  onClarifySubmitted?: (answers: Record<string, string>) => void;
  /** Intermediate lane memos via expandable step "查看产物". */
  onOpenArtifact?: (artifactId: string) => void;
  className?: string;
};

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

function ExpandableStepRow({
  step,
  showRail,
  onOpenArtifact,
}: {
  step: ResearchStep;
  showRail: boolean;
  onOpenArtifact?: (artifactId: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const canExpand = step.detailLines.length > 0 || Boolean(step.artifactId);

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
          ) : step.status === "failed" ? (
            <IconSearch className="h-4 w-4 text-destructive" />
          ) : (
            <IconSearch className="h-4 w-4 text-muted-foreground" />
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
      {open && canExpand ? (
        <div className="mb-1 ml-7 space-y-1 rounded-md border border-border/40 bg-background/80 px-2.5 py-2 text-sm leading-5 text-muted-foreground">
          {step.detailLines.map((line, i) => (
            <p key={`${step.id}-d-${i}`} className="whitespace-pre-wrap">
              {line}
            </p>
          ))}
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
      ) : null}
    </li>
  );
}

function ToolsCard({
  title,
  steps,
  onOpenArtifact,
}: {
  title: string;
  steps: ResearchStep[];
  onOpenArtifact?: (artifactId: string) => void;
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
}: {
  title: string;
  status: "running" | "done" | "failed";
}) {
  return (
    <div className="mb-3 flex items-center gap-2 text-sm leading-5 text-foreground">
      {status === "running" ? (
        <IconSpinner className="h-4 w-4 animate-spin text-primary" />
      ) : status === "failed" ? (
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
      ) : (
        <IconCheck className="h-4 w-4 text-muted-foreground" />
      )}
      <span>{title}</span>
    </div>
  );
}

export function DeepResearchWorkbench({
  deepResearch,
  onClarifySubmitted,
  onOpenArtifact,
  className,
}: DeepResearchWorkbenchProps) {
  const segments = React.useMemo(
    () => buildDeepResearchSegments(deepResearch.events, deepResearch.status),
    [deepResearch.events, deepResearch.status],
  );

  const waitingShell =
    deepResearch.events.length === 0 &&
    (deepResearch.status === "running" || deepResearch.status === "awaiting_clarify");

  const timedOut = deepResearch.events.some((e) => e.type === "clarify_timeout");
  const hasClarify = deepResearch.events.some((e): e is Extract<DeepResearchEvent, { type: "clarify" }> =>
    e.type === "clarify",
  );

  if (waitingShell) {
    return (
      <div className={["mb-3 text-sm leading-5 text-foreground", className].filter(Boolean).join(" ")}>
        <div className="flex items-center gap-2">
          <IconSpinner className="h-4 w-4 animate-spin text-primary" />
          <span>正在启动深度研究…</span>
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
              />
            );
          case "status":
            return (
              <StatusRow key={segment.id} title={segment.title} status={segment.status} />
            );
          default: {
            const _exhaustive: never = segment;
            return _exhaustive;
          }
        }
      })}
    </div>
  );
}
