import { Shimmer } from "../ds/Shimmer";

type Props = {
  title?: string;
  statusLabel: string;
};

/** Reserved canvas while show_widget streams, before SVG/HTML is ready. */
export function ShowWidgetDrawingPlaceholder({ title, statusLabel }: Props) {
  const caption = String(title ?? "").trim();
  return (
    <div className="w-full min-w-0 px-4">
      <div
        className="relative w-full overflow-hidden rounded-md border border-border bg-surface-panel"
        role="status"
        aria-live="polite"
        aria-label={caption ? `${statusLabel} ${caption}` : statusLabel}
      >
        <div className="relative aspect-[16/9] w-full">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-10 bottom-10 flex h-[38%] items-end gap-1.5"
          >
            {[36, 58, 44, 72, 40, 54].map((height, index) => (
              <div
                key={`${height}-${index}`}
                className="flex-1 rounded-sm bg-text-faint/20"
                style={{ height: `${height}%` }}
              />
            ))}
          </div>
          <div
            aria-hidden
            className="agx-widget-draw-sweep pointer-events-none absolute inset-0"
          />
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 px-6">
            <Shimmer variant="status" text={statusLabel} className="text-[13px]" />
            {caption ? (
              <span className="max-w-full truncate text-[12px] text-text-faint">
                {caption}
              </span>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
