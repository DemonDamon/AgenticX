import * as React from "react";
import { cn } from "../lib/cn";

type MachiAvatarProps = {
  className?: string;
  size?: number;
  src?: string;
};

export function MachiAvatar({ className, size = 96, src = "/near-logo.png" }: MachiAvatarProps) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden",
        className
      )}
      style={{ width: size, height: size }}
      aria-label="Near"
    >
      <img
        src={src}
        alt="Near"
        width={size}
        height={size}
        className="h-full w-full object-contain"
      />
    </span>
  );
}

