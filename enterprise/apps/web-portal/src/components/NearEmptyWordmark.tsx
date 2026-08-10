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
 * Empty-state brand lockup: Machi line-art portrait + product wordmark
 * + brand tagline. No hover chrome — the mark is static identity, not a control.
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
        className="h-40 w-40 select-none object-contain opacity-[0.92] dark:invert md:h-44 md:w-44"
      />
      <div className="flex flex-col items-center gap-2 select-none">
        <div
          className={[
            nearDisplay.className,
            "text-[clamp(1.75rem,3.8vw,2.35rem)] font-semibold leading-none tracking-[0.18em]",
            "text-foreground/85",
          ].join(" ")}
          aria-label={tw("emptyWordmark")}
        >
          {tw("emptyWordmark")}
        </div>
        <p className="text-[12px] uppercase tracking-[0.22em] text-muted-foreground/80">
          {tw("emptyTagline")}
        </p>
      </div>
      {caption ? (
        <p className="max-w-md text-sm text-muted-foreground/80">{caption}</p>
      ) : null}
    </div>
  );
}
