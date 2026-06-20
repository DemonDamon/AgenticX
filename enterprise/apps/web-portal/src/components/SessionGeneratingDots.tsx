type SessionGeneratingDotsProps = {
  className?: string;
};

/** Kimi-style 3×3 dot grid shown while a session is generating. */
export function SessionGeneratingDots({ className = "" }: SessionGeneratingDotsProps) {
  return (
    <>
      <style>{`
        @keyframes grid-pulse {
          0%, 100% { opacity: 0.2; transform: scale(0.8); }
          50% { opacity: 1; transform: scale(1); }
        }
        .animate-grid-pulse {
          animation: grid-pulse 1.2s ease-in-out infinite;
        }
      `}</style>
      <span
        className={["inline-grid shrink-0 grid-cols-3 gap-[2px]", className].filter(Boolean).join(" ")}
        aria-hidden
      >
        {Array.from({ length: 9 }, (_, index) => {
          // Create a staggered wave effect from top-left to bottom-right
          const row = Math.floor(index / 3);
          const col = index % 3;
          const delay = (row + col) * 150;
          return (
            <span
              key={index}
              className="h-[2.5px] w-[2.5px] rounded-full bg-current opacity-20 motion-safe:animate-grid-pulse"
              style={{ animationDelay: `${delay}ms` }}
            />
          );
        })}
      </span>
    </>
  );
}
