import * as React from "react";
import { cn } from "../../lib/cn";

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = "text", ...props }, ref) => {
    return (
      <input
        ref={ref}
        type={type}
        className={cn(
          "flex h-9 w-full rounded-md border border-zinc-200 bg-white px-3 py-1 text-sm text-zinc-900 shadow-sm outline-none transition-colors placeholder:text-zinc-400 focus-visible:border-[var(--ui-color-primary)] focus-visible:ring-2 focus-visible:ring-[color-mix(in_oklab,var(--ui-color-primary)_30%,transparent)] disabled:cursor-not-allowed disabled:opacity-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:placeholder:text-zinc-500",
          className
        )}
        {...props}
      />
    );
  }
);

Input.displayName = "Input";

