type SessionGeneratingDotsProps = {
  className?: string;
};

/** Kimi-style 2×3 dot grid shown while a session is generating. */
export function SessionGeneratingDots({ className = "" }: SessionGeneratingDotsProps) {
  return (
    <span
      className={["inline-grid shrink-0 grid-cols-2 gap-[2.5px]", className].filter(Boolean).join(" ")}
      aria-hidden
    >
      {Array.from({ length: 6 }, (_, index) => (
        <span
          key={index}
          className="h-[3px] w-[3px] rounded-full bg-current opacity-70 motion-safe:animate-pulse"
          style={{ animationDelay: `${index * 110}ms` }}
        />
      ))}
    </span>
  );
}
