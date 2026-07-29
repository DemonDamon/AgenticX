import { cn } from "@agenticx/ui";
import { Building2 } from "lucide-react";

export function EnterpriseBrandMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const iconSize = Math.max(14, Math.round(size * 0.58));
  return (
    <span
      aria-hidden="true"
      className={cn("inline-flex shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground", className)}
      style={{ width: size, height: size }}
    >
      <Building2 style={{ width: iconSize, height: iconSize }} strokeWidth={2.1} />
    </span>
  );
}
