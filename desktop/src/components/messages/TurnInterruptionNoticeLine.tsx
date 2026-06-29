import { CirclePause, RotateCcw } from "lucide-react";
import type { Message } from "../../store";
import { parseTurnInterruptionNotice } from "../../utils/turn-interruption-notice";
import { ASSISTANT_ICON_RAIL_CLASS } from "./im-layout";

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
    <div
      className="agx-system-status-line flex min-w-0 items-center gap-2 px-3 py-1 text-[13px] leading-[1.65]"
      data-status-kind="turn-interrupted"
    >
      {/* icon tile */}
      <span className={ASSISTANT_ICON_RAIL_CLASS} aria-hidden>
        <span
          className="flex h-[18px] w-[18px] items-center justify-center rounded-[5px]"
          style={{
            backgroundColor: "rgba(251, 191, 36, 0.10)",
            boxShadow: "inset 0 0 0 1px rgba(251, 191, 36, 0.28)",
            color: "rgba(253, 224, 71, 0.82)",
          }}
        >
          <CirclePause className="h-3 w-3" strokeWidth={2.25} />
        </span>
      </span>

      {/* body */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="text-text-muted">{text}</span>
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
    </div>
  );
}
