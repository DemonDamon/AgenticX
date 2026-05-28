type VoicePttOverlayProps = {
  text: string;
  visible: boolean;
};

export function VoicePttOverlay({ text, visible }: VoicePttOverlayProps) {
  if (!visible) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-full z-30 mb-3 flex justify-center px-4">
      <div
        className="inline-flex max-w-[min(92%,720px)] items-center gap-2.5 rounded-full px-4 py-2.5 shadow-lg"
        style={{ background: "rgb(7, 193, 96)" }}
      >
        <span
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white/95 text-[rgb(7,193,96)]"
          aria-hidden
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-4 w-4">
            <path d="M12 1a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10a7 7 0 0 1-14 0" />
            <path d="M12 17v4" />
          </svg>
        </span>
        <span className="min-w-0 text-[15px] leading-snug text-white">
          {text.trim() ? text : "正在聆听…"}
        </span>
      </div>
    </div>
  );
}
