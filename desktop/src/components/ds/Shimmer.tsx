type Props = {
  text?: string;
  className?: string;
};

export function Shimmer({ text = "Working...", className = "" }: Props) {
  return <span className={`agx-working-shimmer ${className}`}>{text}</span>;
}
