import { cn } from "../../lib/cn";

type GridBackdropProps = {
  className?: string;
};

export function GridBackdrop({ className }: GridBackdropProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.04)_1px,transparent_1px)] bg-[size:32px_32px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_50%,#000_12%,transparent_100%)]",
        className
      )}
    />
  );
}

