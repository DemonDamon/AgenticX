"use client";

import { ENTERPRISE_PRODUCT_NAME } from "./EnterpriseBrandMark";

type NearEmptyWordmarkProps = {
  className?: string;
  caption?: string;
  badgeLabel?: string;
};

/**
 * Empty-state brand mark for the customer-facing product name.
 * Hover: deepen color + slightly tighten tracking + grow a thin underline.
 */
export function NearEmptyWordmark({ className, caption, badgeLabel }: NearEmptyWordmarkProps) {
  return (
    <div className={["flex flex-col items-center gap-2.5 text-center", className].filter(Boolean).join(" ")}>
      <div
        className={[
          "group/near relative inline-flex select-none items-start gap-3",
          "text-[clamp(2.65rem,6.4vw,4.15rem)] font-semibold leading-none tracking-[0.08em]",
          "text-foreground/80",
          "transition-[color,letter-spacing] duration-300 ease-out",
          "hover:tracking-[0.045em] hover:text-foreground",
          "motion-reduce:transition-none motion-reduce:hover:tracking-[0.08em]",
        ].join(" ")}
        aria-label={ENTERPRISE_PRODUCT_NAME}
        role="img"
      >
        <span>{ENTERPRISE_PRODUCT_NAME}</span>
        {badgeLabel ? (
          <span
            className={[
              "mt-1 rounded-full border border-primary/25 bg-primary-soft px-2 py-0.5",
              "text-[clamp(0.65rem,1.3vw,0.8rem)] font-semibold leading-none tracking-[0.08em] text-primary",
              "shadow-[0_8px_20px_-16px_var(--primary)]",
            ].join(" ")}
          >
            {badgeLabel}
          </span>
        ) : null}
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
