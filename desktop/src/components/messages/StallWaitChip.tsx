import { useEffect, useState } from "react";
import { stallWaitChipText, type StallWaitInfo } from "../../utils/stall-wait-chip";

/**
 * Cursor-style patient waiting indicator shown while the backend auto-retries
 * a timed-out LLM round (phase="stall_patient_wait"). Disappears when the
 * caller clears the info (on token/tool_call/final/error/recovered).
 */
export function StallWaitChip({ info }: { info: StallWaitInfo }) {
  const [nowMs, setNowMs] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-0.5 text-[11px] text-amber-200">
      <span className="inline-flex items-center gap-0.5" aria-hidden="true">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="agx-dot-pulse inline-block h-1 w-1 rounded-full bg-amber-300"
            style={{ animationDelay: `${i * 0.18}s` }}
          />
        ))}
      </span>
      <span>{stallWaitChipText(info, nowMs)}</span>
    </span>
  );
}
