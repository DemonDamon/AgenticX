import * as React from "react";
import { cn } from "../lib/cn";

type MachiAvatarProps = {
  className?: string;
  size?: number;
  src?: string;
};

export function MachiAvatar({ className, size = 96, src = "/machi-logo-transparent.png" }: MachiAvatarProps) {
  const isDefaultLogo = src === "/machi-logo-transparent.png";
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
        className={cn(
          "h-full w-full object-cover",
          isDefaultLogo && "dark:invert opacity-90 dark:opacity-100"
        )}
      />
    </span>
  );
}

