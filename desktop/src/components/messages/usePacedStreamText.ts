/**
 * Reveal `source` at wordMs while a group stream is live.
 * Author: Damon Li
 */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  STREAM_WORD_MS,
  joinStreamSegments,
  nextPacedCount,
  prefersStreamReducedMotion,
  segmentStreamText,
} from "./streaming-text";

export function usePacedStreamText(
  source: string,
  active: boolean,
  wordMs = STREAM_WORD_MS,
): string {
  const text = String(source ?? "");
  const segments = useMemo(() => segmentStreamText(text), [text]);
  const countRef = useRef(active ? Math.min(1, segments.length) : segments.length);
  const [count, setCount] = useState(countRef.current);

  useEffect(() => {
    if (!active || prefersStreamReducedMotion()) {
      countRef.current = segments.length;
      setCount(segments.length);
      return;
    }

    const shown = joinStreamSegments(segments, countRef.current);
    if (shown && !text.startsWith(shown)) {
      countRef.current = Math.min(1, segments.length);
      setCount(countRef.current);
    } else if (countRef.current > segments.length) {
      countRef.current = segments.length;
      setCount(segments.length);
    } else if (countRef.current === 0 && segments.length > 0) {
      countRef.current = 1;
      setCount(1);
    }

    if (countRef.current >= segments.length) return;

    let timer = 0;
    const tick = () => {
      const next = nextPacedCount(countRef.current, segments.length);
      countRef.current = next;
      setCount(next);
      if (next < segments.length) {
        timer = window.setTimeout(tick, Math.max(8, wordMs));
      }
    };
    timer = window.setTimeout(tick, Math.max(8, wordMs));
    return () => window.clearTimeout(timer);
  }, [active, segments, text, wordMs]);

  if (!active) return text;
  return joinStreamSegments(segments, count);
}
