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
  const cause = parsed?.cause;
  const isUserInterrupt = cause === "user_interrupt";
  let text: string;
  if (isUserInterrupt) {
    text = "已中断";
  } else if (cause === "runtime_failure") {
    // Prefer the real upstream error surfaced by the backend; fall back to the
    // notice content, then a generic label. Never mislabel a model API 400 as
    // "工具执行后未收到模型响应".
    text = parsed?.failureSummary
      ? `模型调用失败：${parsed.failureSummary}`
      : (parsed?.text || "模型调用失败，本轮未完成");
  } else if (cause === "suspected_truncated_final") {
    text = "这条回答似乎没有说完";
  } else {
    text = "上一步工具执行后未收到模型响应";
  }
  const isSuspectedTruncated = cause === "suspected_truncated_final";

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
            aria-label={isSuspectedTruncated ? "继续" : "恢复执行"}
          >
            <RotateCcw className="h-3 w-3" aria-hidden />
            {resumeInFlight
              ? (isSuspectedTruncated ? "继续中…" : "恢复中…")
              : (isSuspectedTruncated ? "继续" : "恢复执行")}
          </button>
        ) : null}
      </div>
    </SystemStatusLine>
  );
}
