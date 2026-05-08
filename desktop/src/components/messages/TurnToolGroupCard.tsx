import { useMemo, useState } from "react";
import type { Message } from "../../store";
import { ChevronDown, ChevronRight } from "lucide-react";
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

  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-row gap-2">
        <div className="flex h-8 w-8 shrink-0" aria-hidden />
        <div className="flex min-w-0 flex-1 flex-col items-start" style={{ maxWidth: "min(92%, 960px)" }}>
          <div className="w-full min-w-0 overflow-hidden rounded-lg border border-border bg-surface-card text-xs text-text-muted transition">
            <button
              type="button"
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left transition-colors hover:bg-surface-hover"
              onClick={() => setExpanded((v) => !v)}
            >
              <span className="flex-1 truncate text-[11px] font-medium text-text-subtle">{summary}</span>
              {expanded ? (
                <ChevronDown className="h-3 w-3 shrink-0 text-text-muted" />
              ) : (
                <ChevronRight className="h-3 w-3 shrink-0 text-text-muted" />
              )}
            </button>
            {expanded && (
              <div className="space-y-2 border-t border-border px-2 pb-2 pt-2">
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
                      variant="nested"
                    />
                  )
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
