type SessionGeneratingDotsProps = {
  className?: string;
};

/** Kimi / Enterprise 式 3×3 粒子矩阵，会话生成中显示。 */
export function SessionGeneratingDots({ className = "" }: SessionGeneratingDotsProps) {
  return (
    <span
      className={["inline-grid shrink-0 grid-cols-3 gap-[2.5px]", className].filter(Boolean).join(" ")}
      aria-hidden
    >
      {Array.from({ length: 9 }, (_, index) => {
        const row = Math.floor(index / 3);
        const col = index % 3;
        const delay = (row + col) * 150;
        return (
          <span
            key={index}
            className="h-[2.5px] w-[2.5px] rounded-full bg-current opacity-20"
            style={{
              animation: `agx-session-grid-pulse 1.2s ease-in-out infinite ${delay}ms`,
            }}
          />
        );
      })}
    </span>
  );
}
