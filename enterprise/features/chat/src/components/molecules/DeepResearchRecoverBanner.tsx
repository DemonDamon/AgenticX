"use client";

import * as React from "react";
import {
  fetchActiveDeepResearchRuns,
  phaseLabelZh,
  type ActiveDeepResearchRun,
} from "../../utils/deep-research-active-run";

export type DeepResearchRecoverBannerProps = {
  sessionId: string | null | undefined;
  /** Invoked when user clicks recover — parent should open the reconnect stream. */
  onRecover?: (run: ActiveDeepResearchRun) => void;
};

/**
 * Minimal recoverable banner when the session has an in-progress deep-research run.
 * Parent wires `onRecover` into the existing SSE / deep_research rendering pipeline.
 */
export function DeepResearchRecoverBanner({
  sessionId,
  onRecover,
}: DeepResearchRecoverBannerProps) {
  const [run, setRun] = React.useState<ActiveDeepResearchRun | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    if (!sessionId) {
      setRun(null);
      return;
    }
    void (async () => {
      const runs = await fetchActiveDeepResearchRuns(sessionId);
      if (cancelled) return;
      setRun(runs[0] ?? null);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!run) return null;
  // Defensive: healed / terminal runs must never show the recover banner.
  if (run.phase === "done" || run.status === "completed" || run.status === "failed" || run.status === "cancelled") {
    return null;
  }

  const label = `深度调研进行中（${phaseLabelZh(run.phase)}）· 点击继续查看`;

  return (
    <button
      type="button"
      onClick={() => {
        onRecover?.(run);
      }}
      className="mb-3 flex w-full items-center justify-center rounded-md border border-[var(--ui-border-subtle,rgba(127,127,127,0.25))] bg-[var(--ui-surface-muted,rgba(127,127,127,0.08))] px-3 py-2 text-center text-sm text-[var(--ui-text-primary,inherit)] transition-colors hover:bg-[var(--ui-surface-hover,rgba(127,127,127,0.14))]"
    >
      {label}
    </button>
  );
}
