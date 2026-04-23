import * as React from "react";
import { cn } from "../lib/cn";

type MachiAvatarProps = {
  className?: string;
  size?: number;
  src?: string;
};

export function MachiAvatar({ className, size = 96, src = "/machi-lineart-mask.svg" }: MachiAvatarProps) {
  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center overflow-hidden rounded-md border border-zinc-700/70 bg-black text-white",
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
        className="h-full w-full object-contain invert dark:invert-0"
        onError={(event) => {
          const target = event.currentTarget;
          target.style.display = "none";
          const fallback = target.nextElementSibling as HTMLElement | null;
          if (fallback) fallback.style.display = "flex";
        }}
      />
      <span
        className="absolute inset-0 hidden items-center justify-center text-xs font-semibold uppercase tracking-[0.2em]"
        aria-hidden
      >
        Machi
      </span>
    </span>
  );
}

