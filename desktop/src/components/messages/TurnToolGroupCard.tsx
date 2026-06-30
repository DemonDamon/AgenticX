import { useMemo, useState } from "react";
import type { Message } from "../../store";
import { Check, ChevronDown, ChevronRight, Wrench } from "lucide-react";
import { ToolCallCard } from "./ToolCallCard";
import type { ReactNode } from "react";
import { TodoUpdateCard } from "../TodoUpdateCard";
import { isTodoUpdateToolMessage } from "./MessageRenderer";
import type { SkillPatchPreviewPayload } from "./skill-manage-preview";
import { REACT_RAIL_ICON_TILE_STYLE } from "./im-layout";
import { isToolGroupInProgress } from "./group-tool-messages";

type Props = {
  messages: Message[];
  highlightTerms?: string[];
  /** Passed through to each ToolCallCard */
  renderExtras?: (message: Message) => ReactNode;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelectMessage?: (message: Message) => void;
  /** Parent ReAct column already shows Near avatar — drop left spacer. */
  omitLeadingSpacer?: boolean;
  /** When true, remove outer border/rounded so parent unified container provides the single border. */
  flat?: boolean;
  /** Keep header in "calling tools" while the turn is still between sequential calls. */
  holdProgress?: boolean;
  onSkillManageApply?: (message: Message, payload: SkillPatchPreviewPayload, targetIndex: number | null) => void;
};

function countToolNames(msgs: Message[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const msg of msgs) {
    const n = String(msg.toolName ?? "").trim() || "tool";
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return m;
}

function sortedToolCounts(msgs: Message[]): Array<[string, number]> {
  const counts = countToolNames(msgs);
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

function ToolNameChip({ name }: { name: string }) {
  return (
    <span className="inline-flex max-w-[min(100%,12rem)] items-center gap-1 rounded bg-surface-hover px-1.5 py-0.5 font-mono text-[11px] leading-none text-text-strong">
      <Wrench className="h-2.5 w-2.5 shrink-0 text-text-muted" strokeWidth={2.2} aria-hidden />
      <span className="truncate">{name}</span>
    </span>
  );
}

function CompletedToolSummary({ messages }: { messages: Message[] }) {
  const parts = sortedToolCounts(messages);
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 text-[13px] font-medium text-text-subtle">
      <span className="shrink-0">已调用 {messages.length} 次工具</span>
      {parts.length > 0 ? (
        <>
          <span className="shrink-0 text-text-faint" aria-hidden>
            ·
          </span>
          {parts.map(([name, count], index) => (
            <span key={name} className="inline-flex min-w-0 items-center">
              {index > 0 ? <span className="shrink-0 text-text-faint mr-1.5">，</span> : null}
              <span className="shrink-0 tabular-nums mr-1.5">{count} 次</span>
              <ToolNameChip name={name} />
            </span>
          ))}
        </>
      ) : null}
    </span>
  );
}

export function TurnToolGroupCard({
  messages,
  highlightTerms,
  renderExtras,
  selectable,
  selectedIds,
  onToggleSelectMessage,
  omitLeadingSpacer = false,
  flat = false,
  holdProgress = false,
  onSkillManageApply,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const inProgress = useMemo(
    () => isToolGroupInProgress(messages) || holdProgress,
    [holdProgress, messages],
  );

  const cardContent = (
    <div
      className={
        flat
          ? "w-full min-w-0 text-[13px] text-text-muted"
          : "w-full min-w-0 overflow-hidden rounded-lg border border-border bg-surface-card text-[13px] text-text-muted transition"
      }
    >
      <button
        type="button"
        className={`relative z-[1] inline-flex w-full max-w-full items-center gap-2 text-left ${
          flat ? "px-3 py-1" : "px-3 py-3"
        }`}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center" aria-hidden>
          {inProgress ? (
            <span
              className="flex h-4 w-4 items-center justify-center rounded-full"
              style={REACT_RAIL_ICON_TILE_STYLE}
            >
              <Wrench className="h-2.5 w-2.5" strokeWidth={2.45} />
            </span>
          ) : (
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[rgb(var(--theme-color-rgb,59,130,246))] ring-1 ring-[rgba(var(--theme-color-rgb,59,130,246),0.35)]">
              <Check className="h-2.5 w-2.5 text-white" strokeWidth={2.45} />
            </span>
          )}
        </span>
        <span className="flex min-w-0 shrink items-center gap-1.5">
          {inProgress ? (
            <span className="truncate text-[13px] font-medium text-text-subtle">正在调用工具</span>
          ) : (
            <CompletedToolSummary messages={messages} />
          )}
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} aria-hidden />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" strokeWidth={2} aria-hidden />
          )}
        </span>
      </button>
      {expanded && (
        <div
          className={
            flat
              ? "relative px-3 pb-2 pt-0.5 text-[13px] text-text-muted"
              : "relative z-[0] border-t border-border px-3 pb-2 pt-1 text-[13px] text-text-muted"
          }
        >
          {/* 时间线仅在展开列表区，与 nested ToolCallCard 节点同一 X（px-3 12px + half Check 10px = 22px） */}
          <div
            className="pointer-events-none absolute left-[22px] top-0 bottom-2 z-0 w-0 border-l border-dashed border-border"
            aria-hidden
          />
          <div className="relative z-[1] space-y-2.5">
            {messages.map((m) =>
              isTodoUpdateToolMessage(m.content) ? (
                <div key={m.id} className="relative w-full min-w-0 text-[13px] text-text-muted">
                  <div
                    className="pointer-events-none absolute left-[10px] top-[15px] z-[2] h-2 w-2 -translate-x-1/2 rounded-full border-2 border-surface-card bg-border"
                    aria-hidden
                  />
                  <div className="ml-[28px] w-fit max-w-full rounded-lg border border-border bg-surface-card px-3 py-2 text-[13px] text-text-muted">
                    <TodoUpdateCard content={m.content} />
                  </div>
                </div>
              ) : (
                <ToolCallCard
                  key={m.id}
                  message={m}
                  highlightTerms={highlightTerms}
                  forceExpand={!!m.inlineConfirm}
                  selectable={selectable}
                  selected={selectedIds?.has(m.id)}
                  onToggleSelectMessage={onToggleSelectMessage}
                  action={renderExtras?.(m)}
                  variant="nested"
                  omitLeadingSpacer={flat}
                  onSkillManageApply={onSkillManageApply}
                />
              )
            )}
          </div>
        </div>
      )}
    </div>
  );

  if (flat && omitLeadingSpacer) {
    return cardContent;
  }

  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-row gap-2">
        <div className="flex min-w-0 flex-1 flex-col items-start">
          {cardContent}
        </div>
      </div>
    </div>
  );
}
