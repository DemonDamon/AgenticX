/**
 * Outline chat mark for scratch conversations. Same stroke language as the rail icons.
 *
 * Author: Damon Li
 */

export function ScratchChatIcon({
  className,
  strokeWidth = 1.7,
}: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M7.2 18.2 5.4 20.2a.8.8 0 0 1-1.4-.5V7.2A2.2 2.2 0 0 1 6.2 5h11.6a2.2 2.2 0 0 1 2.2 2.2v8.6a2.2 2.2 0 0 1-2.2 2.2H7.2Z" />
      <path d="M8 9.2h8" />
      <path d="M8 12.6h5.2" />
    </svg>
  );
}
