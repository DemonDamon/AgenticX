"use client";

import { Syne } from "next/font/google";

/** Mid weight — brand presence without shouting over the composer. */
const nearDisplay = Syne({
  subsets: ["latin"],
  weight: ["600", "700"],
  display: "swap",
});

type NearEmptyWordmarkProps = {
  className?: string;
  caption?: string;
};

/**
 * Empty-state brand mark: a single baseline-aligned NEAR wordmark.
 * Hover: deepen color + slightly tighten tracking + grow a thin underline.
 */
export function NearEmptyWordmark({ className, caption }: NearEmptyWordmarkProps) {
  return (
    <div className={["flex flex-col items-center gap-2.5 text-center", className].filter(Boolean).join(" ")}>
      <div
        className={[
          nearDisplay.className,
          "group/near relative inline-block select-none",
          "text-[clamp(3.15rem,7.5vw,4.5rem)] font-semibold leading-none tracking-[-0.02em]",
          "text-foreground/80",
          "transition-[color,letter-spacing] duration-300 ease-out",
          "hover:tracking-[-0.045em] hover:text-foreground",
          "motion-reduce:transition-none motion-reduce:hover:tracking-[-0.02em]",
        ].join(" ")}
        aria-label="NEAR"
        role="img"
      >
        NEAR
        <span
          aria-hidden
          className={[
            "pointer-events-none absolute left-1/2 -bottom-[0.22em] h-px w-0 -translate-x-1/2",
            "bg-foreground/40 transition-[width,background-color] duration-300 ease-out",
            "group-hover/near:w-full group-hover/near:bg-foreground/65",
            "motion-reduce:hidden",
          ].join(" ")}
        />
      </div>
      {caption ? (
        <p className="max-w-md text-sm text-muted-foreground/80">{caption}</p>
      ) : null}
    </div>
  );
}
