type Props = {
  size?: number;
  strokeWidth?: number;
  className?: string;
};

/** Boxed card + outbound curve — continue the turn in a new task. */
export function ContinueInNewTaskIcon({
  size = 14,
  strokeWidth = 2,
  className,
}: Props) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <rect x="3.5" y="10.5" width="9" height="9" rx="2" />
      <path d="M12 12.5c.6-4.4 4.8-6.6 8.2-4.2" />
      <path d="M16.8 5.4 20.6 6.8 18.2 10" />
    </svg>
  );
}
