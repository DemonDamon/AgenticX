"use client";

import { Syne } from "next/font/google";
import { useTranslations } from "next-intl";

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
 * Empty-state brand lockup: Machi line-art portrait as the hero mark,
 * plus a single headline sentence. Portrait stays large enough for the
 * wireframe hatching to remain legible (≈160–176px); dark theme inverts
 * the black strokes to white.
 */
export function NearEmptyWordmark({ className, caption }: NearEmptyWordmarkProps) {
  const tw = useTranslations("workspace");

  return (
    <div className={["flex flex-col items-center gap-4 text-center", className].filter(Boolean).join(" ")}>
      <img
        src="/machi-logo-transparent.png"
        alt=""
        width={176}
        height={184}
        draggable={false}
        className={[
          "h-40 w-40 select-none object-contain opacity-[0.92] md:h-44 md:w-44",
          "transition-opacity duration-300 ease-out",
          "dark:invert",
        ].join(" ")}
      />
      <div
        className={[
          nearDisplay.className,
          "group/near relative inline-block select-none",
          "text-[clamp(1.55rem,3.4vw,2.15rem)] font-semibold leading-none tracking-[-0.02em]",
          "text-foreground/80",
          "transition-[color,letter-spacing] duration-300 ease-out",
          "hover:tracking-[-0.035em] hover:text-foreground",
          "motion-reduce:transition-none motion-reduce:hover:tracking-[-0.02em]",
        ].join(" ")}
        aria-label={tw("emptyHeadline")}
      >
        {tw("emptyHeadline")}
        <span
          aria-hidden
          className={[
            "pointer-events-none absolute left-1/2 -bottom-[0.24em] h-px w-0 -translate-x-1/2",
            "bg-foreground/40 transition-[width,background-color] duration-300 ease-out",
            "group-hover/near:w-full group-hover/near:bg-foreground/60",
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
