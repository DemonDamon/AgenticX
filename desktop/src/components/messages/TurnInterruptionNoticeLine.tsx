import { CirclePause, RotateCcw } from "lucide-react";
import type { Message } from "../../store";
import { parseTurnInterruptionNotice } from "../../utils/turn-interruption-notice";
import { SystemStatusLine } from "./SystemStatusLine";

type Props = {
  message: Message;
  resumeInFlight?: boolean;
  onResume?: () => void;
  /** When true, the resume is futile (task already complete) — hide the button. */
  isFutile?: boolean;
};

export function TurnInterruptionNoticeLine({ message, resumeInFlight = false, onResume, isFutile = false }: Props) {
  const parsed = parseTurnInterruptionNotice(message);
  const isUserInterrupt = parsed?.cause === "user_interrupt";
  const text = isUserInterrupt ? "已中断" : "上一步工具执行后未收到模型响应";

  return (
    <SystemStatusLine icon={CirclePause} tone="info" data-status-kind="turn-interrupted">
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span>{text}</span>
        {onResume && !isFutile ? (
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-text-faint transition-colors hover:text-text-subtle disabled:opacity-50"
            disabled={resumeInFlight}
            onClick={() => onResume()}
            aria-label="恢复执行"
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {resumeInFlight ? "恢复中…" : "恢复执行"}
          </button>
        ) : null}
      </div>
    </SystemStatusLine>
  );
}
