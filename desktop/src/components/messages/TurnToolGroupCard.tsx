import { useMemo, useState } from "react";
import type { Message } from "../../store";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { ToolCallCard } from "./ToolCallCard";
import type { ReactNode } from "react";
import { TodoUpdateCard } from "../TodoUpdateCard";
import { isTodoUpdateToolMessage } from "./MessageRenderer";

type Props = {
  messages: Message[];
  highlightTerms?: string[];
  /** Passed through to each ToolCallCard */
  renderExtras?: (message: Message) => ReactNode;
  selectable?: boolean;
  selectedIds?: Set<string>;
  onToggleSelectMessage?: (message: Message) => void;
  /** Parent ReAct column already shows Machi avatar — drop left spacer. */
  omitLeadingSpacer?: boolean;
  /** When true, remove outer border/rounded so parent unified container provides the single border. */
  flat?: boolean;
};

function countToolNames(msgs: Message[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const msg of msgs) {
    const n = String(msg.toolName ?? "").trim() || "tool";
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return m;
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
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const summary = useMemo(() => {
    const counts = countToolNames(messages);
    const parts = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, c]) => `${c} ${name}`);
    const head = `本次调用 ${messages.length} 个工具`;
    return parts.length ? `${head} · ${parts.join("，")}` : head;
  }, [messages]);

  const cardContent = (
    <div className={flat ? "w-full min-w-0 text-xs text-text-muted" : "w-full min-w-0 overflow-hidden rounded-lg border border-border bg-surface-card text-xs text-text-muted transition"}>
      <button
        type="button"
        className="inline-flex w-full max-w-full items-center gap-2 px-3 py-2 text-left"
        onClick={() => setExpanded((v) => !v)}
      >
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--theme-color-rgb,59,130,246))] ring-1 ring-[rgba(var(--theme-color-rgb,59,130,246),0.5)]"
          aria-hidden
        >
          <Check
            className="h-2.5 w-2.5 text-white"
            strokeWidth={2.5}
          />
        </span>
        <span className="min-w-0 flex-1 truncate text-xs font-medium text-text-subtle">{summary}</span>
        {expanded ? (
          <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" />
        ) : (
          <ChevronRight className="h-3 w-3 shrink-0 text-text-muted" />
        )}
      </button>
      {expanded && (
        <div
          className={
            flat
              ? "relative pl-6 pr-3 pb-2 pt-0.5 text-xs text-text-muted"
              : "relative border-t border-border pl-6 pr-3 pb-2 pt-2 text-xs text-text-muted"
          }
        >
          {/* Vertical timeline: starts below summary row (does not pierce circle-check); X aligns with circle center. */}
          <div
            className="pointer-events-none absolute top-0 bottom-2 left-[calc(0.75rem+0.5rem)] z-0 w-0 -translate-x-1/2 border-l border-dashed border-zinc-500/45"
            aria-hidden
          />
          <div className="relative z-[1] space-y-2">
            {messages.map((m) =>
              isTodoUpdateToolMessage(m.content) ? (
                <div
                  key={m.id}
                  className="rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-muted"
                >
                  <TodoUpdateCard content={m.content} />
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
                  variant={flat ? "flat" : "nested"}
                  omitLeadingSpacer={flat}
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
