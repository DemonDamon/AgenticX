import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/cn";

const alertVariants = cva("relative w-full rounded-lg border p-4", {
  variants: {
    variant: {
      default: "border-zinc-200 bg-white text-zinc-900 dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100",
      warning: "border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-200",
      destructive: "border-red-300 bg-red-50 text-red-950 dark:border-red-700 dark:bg-red-950/30 dark:text-red-200",
      success: "border-emerald-300 bg-emerald-50 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-200",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

type AlertProps = React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof alertVariants>;

export const Alert = React.forwardRef<HTMLDivElement, AlertProps>(({ className, variant, ...props }, ref) => (
  <div ref={ref} role="alert" className={cn(alertVariants({ variant }), className)} {...props} />
));
Alert.displayName = "Alert";

export const AlertTitle = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLHeadingElement>>(
  ({ className, ...props }, ref) => <h5 ref={ref} className={cn("mb-1 font-semibold leading-none tracking-tight", className)} {...props} />
);
AlertTitle.displayName = "AlertTitle";

export const AlertDescription = React.forwardRef<HTMLParagraphElement, React.HTMLAttributes<HTMLParagraphElement>>(
  ({ className, ...props }, ref) => <div ref={ref} className={cn("text-sm opacity-90", className)} {...props} />
);
AlertDescription.displayName = "AlertDescription";

