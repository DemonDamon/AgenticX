import * as React from "react";
import * as LabelPrimitive from "@radix-ui/react-label";
import { cn } from "../../lib/cn";

export const Label = React.forwardRef<
  React.ElementRef<typeof LabelPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof LabelPrimitive.Root>
>(({ className, ...props }, ref) => (
  <LabelPrimitive.Root
    ref={ref}
    className={cn(
      "text-sm font-medium leading-none text-zinc-700 peer-disabled:cursor-not-allowed peer-disabled:opacity-70 dark:text-zinc-200",
      className
    )}
    {...props}
  />
));
Label.displayName = LabelPrimitive.Root.displayName;

