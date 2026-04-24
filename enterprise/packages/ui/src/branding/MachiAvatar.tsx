import * as React from "react";
import { cn } from "../lib/cn";

type MachiAvatarProps = {
  className?: string;
  size?: number;
  src?: string;
};

export function MachiAvatar({ className, size = 96, src = "/machi-logo-transparent.png" }: MachiAvatarProps) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden rounded-md",
        className
      )}
      style={{ width: size, height: size }}
      aria-label="Machi avatar"
    >
      <img
        src={src}
        alt="Machi"
        width={size}
        height={size}
        className="h-full w-full object-cover"
      />
    </span>
  );
}

