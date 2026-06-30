import { HelpCircle } from "lucide-react";
import type { PendingClarification } from "../../store";

type Props = {
  prompt: PendingClarification;
  suspended?: boolean;
  onReply?: (prompt: PendingClarification) => void;
};

/**
 * Inline card for a persisted clarification prompt (metadata.kind="clarification").
 *
 * Shows the question and preset options; if the prompt is still unresolved,
 * offers a "回复" button that re-opens the ClarificationDialog via the pane's
 * onOpenClarification handler. When suspended (unattended/automation), shows a
 * muted hint instead of the reply button.
 */
export function ClarificationCard({ prompt, suspended, onReply }: Props) {
  const opts = (prompt.options ?? []).filter((o) => typeof o === "string" && o.trim());
  return (
    <div className="my-2 w-full min-w-0 overflow-hidden rounded-lg border border-cyan-500/40 bg-surface-card text-[13px] leading-relaxed">
      <div className="flex items-start gap-2.5 px-4 py-3">
        <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-cyan-400" />
        <div className="min-w-0 flex-1">
          <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-cyan-300/80">
            需要你的输入
          </div>
          <p className="whitespace-pre-wrap break-words text-sm text-text-primary">{prompt.prompt}</p>
          {opts.length > 0 ? (
            <ul className="mt-2 flex flex-col gap-1">
              {opts.map((opt) => (
                <li
                  key={opt}
                  className="rounded-md border border-border bg-surface-panel px-2.5 py-1.5 text-[12px] text-text-muted"
                >
                  {opt}
                </li>
              ))}
            </ul>
          ) : null}
          {suspended ? (
            <div className="mt-2 text-[11px] text-amber-300/80">
              无人值守会话已挂起，等待下次回来时再继续。
            </div>
          ) : onReply ? (
            <div className="mt-2.5">
              <button
                type="button"
                onClick={() => onReply(prompt)}
                className="rounded-md border border-border bg-surface-hover px-3 py-1.5 text-[12px] text-text-strong hover:opacity-90"
              >
                回复
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
