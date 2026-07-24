import { useEffect, useRef, useState } from "react";

export function normalizeToolElapsedSeconds(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

export function formatToolElapsedSeconds(value: unknown): string {
  const total = normalizeToolElapsedSeconds(value);
  if (total < 60) return `${total}s`;
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

/**
 * Frontend-owned tool clock. Backend progress remains an authoritative lower
 * bound, while the local interval keeps moving when an SSE proxy buffers
 * progress frames during long file/document operations.
 */
export function useLiveToolElapsedSeconds(
  identity: string,
  active: boolean,
  reportedSeconds?: number,
): number {
  const reported = normalizeToolElapsedSeconds(reportedSeconds);
  const [elapsed, setElapsed] = useState(reported);
  const elapsedRef = useRef(reported);
  const identityRef = useRef(identity);

  useEffect(() => {
    const sameTool = identityRef.current === identity;
    identityRef.current = identity;
    const baseline = sameTool ? Math.max(elapsedRef.current, reported) : reported;
    elapsedRef.current = baseline;
    setElapsed(baseline);

    if (!active) return undefined;
    const startedAt = Date.now();
    const timer = window.setInterval(() => {
      const next = Math.max(
        elapsedRef.current,
        baseline + Math.floor((Date.now() - startedAt) / 1000),
      );
      elapsedRef.current = next;
      setElapsed(next);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [active, identity, reported]);

  return elapsed;
}
