import { useLayoutEffect, useRef, useState } from "react";
import { createResizeRafScheduler } from "../../utils/resize-raf";

type Props = {
  text: string;
  className?: string;
};

/**
 * Fill the parent box with as many complete text lines as fit, then ellipsis.
 * Avoids mid-glyph clipping from overflow:hidden on a stretched flex child.
 */
export function ClampToFitText({ text, className = "" }: Props) {
  const ref = useRef<HTMLParagraphElement>(null);
  const [lines, setLines] = useState(4);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const { schedule, cancel } = createResizeRafScheduler(() => {
      const style = getComputedStyle(el);
      let lineHeight = parseFloat(style.lineHeight);
      if (!Number.isFinite(lineHeight) || lineHeight <= 0) {
        const fontSize = parseFloat(style.fontSize) || 12;
        lineHeight = fontSize * 1.25;
      }
      const height = el.clientHeight;
      setLines(Math.max(1, Math.floor(height / lineHeight)));
    });

    schedule();
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    return () => {
      cancel();
      observer.disconnect();
    };
  }, [text]);

  return (
    <p
      ref={ref}
      className={className}
      style={{
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: lines,
        overflow: "hidden",
      }}
    >
      {text}
    </p>
  );
}
