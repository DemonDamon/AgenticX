type Props = {
  size?: "sm" | "md";
  className?: string;
};

export function Spinner({ size = "md", className = "" }: Props) {
  const sizeClass = size === "sm" ? "h-3.5 w-3.5 border-[1.5px]" : "h-4 w-4 border-2";
  return <span className={`inline-block animate-spin rounded-full border-border border-t-text-strong ${sizeClass} ${className}`} />;
}
