"use client";

import * as React from "react";
import type { ChatMessageDeepResearch, DeepResearchEvent } from "@agenticx/core-api";
import { buildDeepResearchSteps, type ResearchStep } from "./deep-research-steps";

export type DeepResearchTimelineProps = {
  events: DeepResearchEvent[];
  status?: ChatMessageDeepResearch["status"];
  clarifyAnswers?: Record<string, string>;
  /** When true, clarify is handled by DeepResearchClarifyCard — omit summary row. */
  omitClarifySummary?: boolean;
  onOpenArtifact?: (artifactId: string) => void;
  className?: string;
};

function IconCircle({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
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

function IconX({ className }: { className?: string }) {
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
      <circle cx="12" cy="12" r="10" />
      <path d="m15 9-6 6" />
      <path d="m9 9 6 6" />
    </svg>
  );
}

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

function IconFile({ className }: { className?: string }) {
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
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

function IconMessage({ className }: { className?: string }) {
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
      <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />
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

function StepIcon({ step }: { step: ResearchStep }) {
  const className = "h-3.5 w-3.5 shrink-0 text-muted-foreground";
  if (step.status === "failed") return <IconX className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  if (step.status === "running") {
    return <IconSpinner className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />;
  }
  switch (step.kind) {
    case "clarify":
      return <IconMessage className={className} />;
    case "lane":
    case "search":
      return <IconSearch className={className} />;
    case "artifact":
      return <IconFile className={className} />;
    case "phase":
      return step.status === "done" ? (
        <IconCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <IconCircle className={className} />
      );
    default:
      return <IconCircle className={className} />;
  }
}

export function DeepResearchTimeline({
  events,
  status,
  clarifyAnswers,
  omitClarifySummary = true,
  onOpenArtifact,
  className,
}: DeepResearchTimelineProps) {
  const waitingShell =
    events.length === 0 && (status === "running" || status === "awaiting_clarify");
  const steps = React.useMemo(() => {
    const built = buildDeepResearchSteps(events, status, clarifyAnswers);
    return omitClarifySummary ? built.filter((s) => s.kind !== "clarify") : built;
  }, [events, status, clarifyAnswers, omitClarifySummary]);

  const [expanded, setExpanded] = React.useState<Record<string, boolean>>({});

  if (!events.length && !waitingShell) return null;

  return (
    <div
      className={["mb-3 rounded-xl border border-border/50 bg-muted/20 px-3 py-2.5", className]
        .filter(Boolean)
        .join(" ")}
      data-testid="deep-research-timeline"
    >
      <div className="mb-2 text-xs font-medium text-muted-foreground">研究过程</div>
      {waitingShell ? (
        <div className="flex items-center gap-2 text-xs text-foreground/85">
          <IconSpinner className="h-3.5 w-3.5 animate-spin text-primary" />
          <span>正在启动深度研究…</span>
        </div>
      ) : (
        <ol className="relative space-y-0.5">
          {steps.map((step, index) => {
            const isOpen = Boolean(expanded[step.id]);
            const canExpand = step.detailLines.length > 0 || Boolean(step.artifactId);
            const isLast = index === steps.length - 1;
            return (
              <li key={step.id} className="relative">
                {!isLast ? (
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
                    setExpanded((prev) => ({ ...prev, [step.id]: !prev[step.id] }));
                  }}
                  className={[
                    "flex w-full items-start gap-2 rounded-lg px-1.5 py-1.5 text-left text-xs transition-colors",
                    canExpand ? "hover:bg-muted/60" : "cursor-default",
                    step.status === "running" ? "bg-muted/50" : "",
                    step.status === "failed" ? "text-destructive" : "text-foreground/90",
                  ].join(" ")}
                >
                  <span className="relative z-[1] mt-0.5 flex h-4 w-4 items-center justify-center bg-muted/20">
                    <StepIcon step={step} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{step.title}</span>
                    {step.subtitle ? (
                      <span className="text-muted-foreground"> | {step.subtitle}</span>
                    ) : null}
                    {step.status === "running" ? (
                      <span className="ml-1.5 inline-flex items-center gap-0.5 text-muted-foreground">
                        <span className="agx-thinking-dot h-1 w-1 rounded-full bg-muted-foreground/70" />
                        <span className="agx-thinking-dot h-1 w-1 rounded-full bg-muted-foreground/70 [animation-delay:160ms]" />
                        <span className="agx-thinking-dot h-1 w-1 rounded-full bg-muted-foreground/70 [animation-delay:320ms]" />
                      </span>
                    ) : null}
                  </span>
                  {canExpand ? (
                    <IconChevronRight
                      className={[
                        "mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                        isOpen ? "rotate-90" : "",
                      ].join(" ")}
                    />
                  ) : null}
                </button>
                {isOpen && canExpand ? (
                  <div className="mb-1 ml-7 space-y-1 rounded-md border border-border/40 bg-background/80 px-2.5 py-2 text-[11px] leading-5 text-muted-foreground">
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
          })}
        </ol>
      )}
    </div>
  );
}
