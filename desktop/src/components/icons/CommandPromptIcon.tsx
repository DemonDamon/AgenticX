import { forwardRef } from "react";
import type { SVGProps } from "react";

/** Prompt mark `>_`, same stroke as the composer command row. */
export const CommandPromptIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function CommandPromptIcon({ className, strokeWidth = 2, ...props }, ref) {
    return (
      <svg
        ref={ref}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        xmlns="http://www.w3.org/2000/svg"
        className={className}
        aria-hidden
        {...props}
      >
        <path d="M4 17l6-5-6-5" />
        <path d="M12 19h8" />
      </svg>
    );
  },
);
