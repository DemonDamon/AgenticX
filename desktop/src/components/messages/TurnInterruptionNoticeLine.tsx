import { AlertTriangle, Play } from "lucide-react";
import type { Message } from "../../store";
import { parseTurnInterruptionNotice } from "../../utils/turn-interruption-notice";

type Props = {
  message: Message;
  resumeInFlight?: boolean;
  onResume?: () => void;
  /** When true, the resume is futile (task already complete) — hide the button. */
  isFutile?: boolean;
};

export function TurnInterruptionNoticeLine({ message, resumeInFlight = false, onResume, isFutile = false }: Props) {
  const parsed = parseTurnInterruptionNotice(message);
  const text = parsed?.text ?? String(message.content ?? "").trim();
  if (!text) return null;

  return (
    <div className="flex min-w-0 items-start gap-2">
      <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/50 bg-amber-500/10 text-amber-200">
        <AlertTriangle className="h-4 w-4" aria-hidden />
      </div>
      <div
        className="min-w-0 flex-1 rounded-lg border border-amber-500/45 bg-amber-500/8 px-3 py-2.5 text-[13px] leading-relaxed text-text-subtle"
        data-status-kind="turn-interrupted"
      >
        <p>{text}</p>
        {onResume && !isFutile ? (
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-md border border-amber-500/50 bg-surface-card px-2.5 py-1 text-[12px] font-medium text-text-strong hover:bg-surface-hover disabled:opacity-60"
              disabled={resumeInFlight}
              onClick={() => onResume()}
            >
              <Play className="h-3.5 w-3.5" aria-hidden />
              {resumeInFlight ? "恢复中…" : "恢复执行"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
