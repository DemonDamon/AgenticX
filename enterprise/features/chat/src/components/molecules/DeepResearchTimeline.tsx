"use client";

import * as React from "react";
import type { ChatMessageDeepResearch, DeepResearchEvent } from "@agenticx/core-api";
import { labelForDeepResearchEvent } from "./deep-research-timeline-labels";

export type DeepResearchTimelineProps = {
  events: DeepResearchEvent[];
  status?: ChatMessageDeepResearch["status"];
  className?: string;
};

function isActiveEvent(event: DeepResearchEvent, status?: ChatMessageDeepResearch["status"]): boolean {
  if (status === "completed" || status === "failed" || status === "cancelled") return false;
  if (event.type === "lane_started" || event.type === "phase") return true;
  if (event.type === "clarify" && status === "awaiting_clarify") return true;
  return false;
}

export function DeepResearchTimeline({ events, status, className }: DeepResearchTimelineProps) {
  const waitingShell =
    events.length === 0 && (status === "running" || status === "awaiting_clarify");
  if (!events.length && !waitingShell) return null;

  const lastIndex = events.length - 1;

  return (
    <div
      className={["mb-3 rounded-xl border border-border/50 bg-muted/30 px-3 py-2.5", className]
        .filter(Boolean)
        .join(" ")}
      data-testid="deep-research-timeline"
    >
      <div className="mb-2 text-xs font-medium text-muted-foreground">研究过程</div>
      {waitingShell ? (
        <div className="flex items-center gap-2 text-xs text-foreground/85">
          <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
          <span>正在启动深度研究…</span>
          <span className="inline-flex items-center gap-0.5 text-muted-foreground">
            <span className="agx-thinking-dot h-1 w-1 rounded-full bg-muted-foreground/70" />
            <span className="agx-thinking-dot h-1 w-1 rounded-full bg-muted-foreground/70 [animation-delay:160ms]" />
            <span className="agx-thinking-dot h-1 w-1 rounded-full bg-muted-foreground/70 [animation-delay:320ms]" />
          </span>
        </div>
      ) : (
        <ol className="space-y-2">
          {events.map((event, index) => {
            const active = index === lastIndex && isActiveEvent(event, status);
            const failed = event.type === "lane_done" && event.status === "failed";
            return (
              <li key={`${event.type}-${index}`} className="flex items-start gap-2 text-xs leading-5">
                <span
                  className={[
                    "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                    failed ? "bg-destructive" : active ? "bg-primary" : "bg-muted-foreground/50",
                  ].join(" ")}
                />
                <span className={failed ? "text-destructive" : "text-foreground/85"}>
                  {labelForDeepResearchEvent(event)}
                  {active ? (
                    <span className="ml-1.5 inline-flex items-center gap-0.5 text-muted-foreground">
                      <span className="agx-thinking-dot h-1 w-1 rounded-full bg-muted-foreground/70" />
                      <span className="agx-thinking-dot h-1 w-1 rounded-full bg-muted-foreground/70 [animation-delay:160ms]" />
                      <span className="agx-thinking-dot h-1 w-1 rounded-full bg-muted-foreground/70 [animation-delay:320ms]" />
                    </span>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
