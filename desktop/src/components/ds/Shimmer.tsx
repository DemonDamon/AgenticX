type Props = {
  text?: string;
  className?: string;
  /**
   * `status` = stronger light/dark sweep for faint meta rows
   * (e.g. tool "运行中 · 1s" / reasoning "思考中 · 1s").
   */
  variant?: "default" | "status";
};

export function Shimmer({ text = "Working...", className = "", variant = "default" }: Props) {
  const variantClass = variant === "status" ? " agx-status-shimmer" : "";
  return <span className={`agx-working-shimmer${variantClass} ${className}`.trim()}>{text}</span>;
}
