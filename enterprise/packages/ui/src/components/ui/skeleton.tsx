import * as React from "react";
import { cn } from "../../lib/cn";

export function Skeleton({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("animate-pulse rounded-md bg-zinc-200 dark:bg-zinc-800", className)} {...props} />;
}

