import { useEffect, useRef } from "react";

type Props = {
  lines: string[];
  maxVisible?: number;
};

export function ToolOutputStream({ lines, maxVisible = 30 }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [lines.length]);

  if (lines.length === 0) return null;

  const visible = lines.length > maxVisible ? lines.slice(-maxVisible) : lines;
  const truncated = lines.length > maxVisible ? lines.length - maxVisible : 0;

  return (
    <div
      ref={containerRef}
      className="mt-1 max-h-[200px] overflow-y-auto rounded border border-border bg-surface-panel/60 px-2 py-1.5 font-mono text-xs leading-relaxed text-text-muted"
    >
      {truncated > 0 && (
        <div className="mb-1 text-[11px] text-text-faint">
          ... {truncated} line{truncated > 1 ? "s" : ""} hidden
        </div>
      )}
      {visible.map((line, i) => (
        <div key={lines.length - visible.length + i} className="whitespace-pre-wrap break-all">
          {line || "\u00A0"}
        </div>
      ))}
    </div>
  );
}
