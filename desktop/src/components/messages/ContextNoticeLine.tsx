type Props = {
  text: string;
};

/** Flat, non-expandable context/token budget notice — aligned with TurnToolGroupCard check row. */
export function ContextNoticeLine({ text }: Props) {
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-1 text-[13px] text-text-muted">
      <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center" aria-hidden>
        <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-amber-400/15 ring-1 ring-amber-400/35">
          <span className="select-none text-[11px] leading-none text-amber-400/90">◈</span>
        </span>
      </span>
      <span className="min-w-0 break-words leading-[1.65]">{text}</span>
    </div>
  );
}
