/**
 * Theme-following Near cube mark for tiny identity slots.
 * Author: Damon Li
 */
const OUTER_SHELL =
  "M64.1 17.1C71.4 12.1 83.4 11.8 90.9 16.5L133.0 42.6C140.5 47.3 146.3 58.3 145.9 67.1L144.7 97.4C144.3 106.2 137.8 117.1 130.3 121.6L93.0 143.8C85.5 148.3 73.1 148.3 65.6 143.7L29.9 121.9C22.4 117.3 15.9 106.4 15.5 97.6L14.1 68.1C13.7 59.3 19.3 48.0 26.6 43.0L64.1 17.1Z";

type Props = {
  label?: string;
  className?: string;
};

export function NearLineArtMark({ label, className }: Props) {
  return (
    <svg
      viewBox="0 0 160 160"
      role="img"
      aria-label={label}
      data-avatar-fit="line-art"
      className={["agx-near-line-art", className].filter(Boolean).join(" ")}
    >
      <path
        d={OUTER_SHELL}
        fill="none"
        stroke="currentColor"
        strokeWidth={7.5}
        strokeLinejoin="round"
      />
      <ellipse
        cx="106"
        cy="104"
        rx="5.8"
        ry="11.6"
        fill="currentColor"
        transform="rotate(1 106 104)"
      />
      <ellipse
        cx="128"
        cy="92"
        rx="5.8"
        ry="11.6"
        fill="currentColor"
        transform="rotate(1 128 92)"
      />
    </svg>
  );
}
