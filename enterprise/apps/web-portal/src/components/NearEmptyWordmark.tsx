"use client";

import { ENTERPRISE_PRODUCT_NAME } from "./EnterpriseBrandMark";

type NearEmptyWordmarkProps = {
  className?: string;
  caption?: string;
};

/**
 * Empty-state brand mark for the customer-facing product name.
 * Hover: deepen color + slightly tighten tracking + grow a thin underline.
 */
export function NearEmptyWordmark({ className, caption }: NearEmptyWordmarkProps) {
  return (
    <div className={["flex flex-col items-center gap-2.5 text-center", className].filter(Boolean).join(" ")}>
      <div
        className={[
          "group/near relative inline-block select-none",
          "text-[clamp(2.65rem,6.4vw,4.15rem)] font-semibold leading-none tracking-[0.08em]",
          "text-foreground/80",
          "transition-[color,letter-spacing] duration-300 ease-out",
          "hover:tracking-[0.045em] hover:text-foreground",
          "motion-reduce:transition-none motion-reduce:hover:tracking-[0.08em]",
        ].join(" ")}
        aria-label={ENTERPRISE_PRODUCT_NAME}
        role="img"
      >
        {ENTERPRISE_PRODUCT_NAME}
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
