/**
 * Live group expert activity card. Not a chat Message.
 * Author: Damon Li
 */
import { useState } from "react";
import { AlertCircle, ChevronDown, ChevronRight } from "lucide-react";
import {
  formatActivityElapsed,
  formatGroupToolLabel,
  stripTrailingStatusEllipsis,
  type GroupExpertActivity,
} from "../../utils/group-expert-activity";
import { HoverTip } from "../ds/HoverTip";
import { Shimmer } from "../ds/Shimmer";
import { ChatImAvatar } from "./ImBubble";

type Props = {
  activity: GroupExpertActivity;
  now: number;
  /** Test hook so static markup can assert the expanded tool list. */
  defaultExpanded?: boolean;
};

function WorkingEllipsis() {
  return (
    <span className="agx-working-ellipsis text-text-faint" aria-hidden="true">
      <span>.</span>
      <span>.</span>
      <span>.</span>
    </span>
  );
}

function toolStepLabel(toolName: string): string {
  return formatGroupToolLabel(toolName) || "工具";
}

export function GroupExpertActivityCard({ activity, now, defaultExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const elapsed = formatActivityElapsed(activity.startedAt, now);
  const waiting = activity.phase === "waiting";
  const hasSteps = activity.toolSteps.length > 0;
  const summaryText = waiting
    ? activity.summary
    : stripTrailingStatusEllipsis(activity.summary);

  return (
    <div
      className="agx-group-expert-activity ml-3 mb-2 flex max-w-[min(100%,680px)] items-start gap-2"
      data-agent-id={activity.agentId}
      data-phase={activity.phase}
    >
      <ChatImAvatar
        label={activity.avatarName}
        imageUrl={activity.avatarUrl}
        variant="circle"
        avatarId={activity.agentId}
        size="sm"
      />
      <div className="min-w-0 flex-1 rounded-xl bg-surface-card/60 px-3 py-2">
        <div className="text-[12px] leading-none text-text-faint">{activity.avatarName}</div>
        <div className="agx-group-activity-status mt-1 flex w-fit max-w-full flex-wrap items-center gap-1.5">
          {waiting ? (
            <p className="min-w-0 text-[13px] leading-snug text-text-muted">{summaryText}</p>
          ) : (
            <span className="inline-flex min-w-0 items-baseline text-[13px] leading-snug">
              <Shimmer
                variant="status"
                text={summaryText}
                className="min-w-0 text-[13px] leading-snug"
              />
              <WorkingEllipsis />
            </span>
          )}
          {waiting ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden="true" />
          ) : null}
          {waiting ? (
            <span className="shrink-0 text-[11px] tabular-nums text-text-faint">{elapsed}</span>
          ) : (
            <Shimmer
              variant="status"
              text={elapsed}
              className="shrink-0 text-[11px] tabular-nums"
            />
          )}
          {hasSteps ? (
            <HoverTip label="查看最近工具步骤">
              <button
                type="button"
                className="inline-flex h-5 w-5 items-center justify-center rounded text-text-faint hover:bg-surface-hover hover:text-text-strong"
                aria-expanded={expanded}
                onClick={() => setExpanded((prev) => !prev)}
              >
                {expanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
              </button>
            </HoverTip>
          ) : null}
        </div>
        {expanded && hasSteps ? (
          <ul className="mt-2 space-y-2 border-t border-border/40 pt-2">
            {activity.toolSteps.map((step) => {
              const label = toolStepLabel(step.toolName);
              const running = step.phase !== "done";
              const status = running ? "进行中" : "已完成";
              const title = `${label} · ${status}`;
              return (
                <li key={step.callId} className="min-w-0 text-[11px] leading-snug text-text-muted">
                  {running ? (
                    <Shimmer variant="status" text={title} className="text-[11px]" />
                  ) : (
                    <div className="text-text-muted">{title}</div>
                  )}
                  {step.detail ? (
                    running ? (
                      <Shimmer
                        variant="status"
                        text={step.detail}
                        className="mt-0.5 block text-[11px]"
                      />
                    ) : (
                      <div className="mt-0.5 break-all text-text-faint">{step.detail}</div>
                    )
                  ) : null}
                  {step.output ? (
                    <div className="mt-0.5 break-all text-text-faint">{step.output}</div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
