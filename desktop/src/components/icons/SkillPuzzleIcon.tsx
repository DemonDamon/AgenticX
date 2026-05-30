import { forwardRef } from "react";
import type { SVGProps } from "react";

/**
 * Rounded single jigsaw-piece outline (top knob + right knob + bottom socket),
 * matching the product reference. Stroke-based for a soft, modern look.
 */
const PUZZLE_PATH =
  "M6 5 L9 5 a3 3 0 1 1 4 0 L16 5 Q18 5 18 7 L18 10 a3 3 0 1 1 0 4 L18 17 Q18 19 16 19 L13 19 a3 3 0 1 0 -4 0 L6 19 Q4 19 4 17 L4 7 Q4 5 6 5 Z";

export const SkillPuzzleIcon = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(
  function SkillPuzzleIcon({ className, strokeWidth = 2, ...props }, ref) {
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
        className={className ? `skill-puzzle-icon ${className}` : "skill-puzzle-icon"}
        aria-hidden
        {...props}
      >
        <path d={PUZZLE_PATH} />
      </svg>
    );
  },
);

/** Inline SVG for contenteditable composer chips (non-React DOM). */
export function skillPuzzleIconInnerHtml(sizePx = 11): string {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" xmlns="http://www.w3.org/2000/svg" style="width:${sizePx}px;height:${sizePx}px;display:inline-block;vertical-align:middle;opacity:0.85"><path d="${PUZZLE_PATH}"/></svg>`;
}
