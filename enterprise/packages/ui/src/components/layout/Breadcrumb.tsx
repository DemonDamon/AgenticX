"use client";

import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../../lib/cn";

export const Breadcrumb = React.forwardRef<HTMLElement, React.HTMLAttributes<HTMLElement>>(
  ({ className, ...props }, ref) => (
    <nav ref={ref} aria-label="Breadcrumb" className={cn("flex items-center text-sm text-muted-foreground", className)} {...props} />
  )
);
Breadcrumb.displayName = "Breadcrumb";

export const BreadcrumbList = React.forwardRef<HTMLOListElement, React.OlHTMLAttributes<HTMLOListElement>>(
  ({ className, ...props }, ref) => (
    <ol ref={ref} className={cn("flex flex-wrap items-center gap-1.5 break-words", className)} {...props} />
  )
);
BreadcrumbList.displayName = "BreadcrumbList";

export const BreadcrumbItem = React.forwardRef<HTMLLIElement, React.LiHTMLAttributes<HTMLLIElement>>(
  ({ className, ...props }, ref) => <li ref={ref} className={cn("inline-flex items-center gap-1.5", className)} {...props} />
);
BreadcrumbItem.displayName = "BreadcrumbItem";

type BreadcrumbLinkProps = React.AnchorHTMLAttributes<HTMLAnchorElement> & { asChild?: boolean };

export const BreadcrumbLink = React.forwardRef<HTMLAnchorElement, BreadcrumbLinkProps>(
  ({ className, asChild, ...props }, ref) => {
    if (asChild && React.isValidElement<{ className?: string }>(props.children)) {
      const child = props.children;
      const childClassName = child.props.className;
      return React.cloneElement(child, {
        className: cn("transition-colors hover:text-foreground", childClassName, className),
      });
    }
    return <a ref={ref} className={cn("transition-colors hover:text-foreground", className)} {...props} />;
  }
);
BreadcrumbLink.displayName = "BreadcrumbLink";

export const BreadcrumbPage = React.forwardRef<HTMLSpanElement, React.HTMLAttributes<HTMLSpanElement>>(
  ({ className, ...props }, ref) => (
    <span ref={ref} aria-current="page" className={cn("font-medium text-foreground", className)} {...props} />
  )
);
BreadcrumbPage.displayName = "BreadcrumbPage";

export const BreadcrumbSeparator = ({ className, children, ...props }: React.HTMLAttributes<HTMLLIElement>) => (
  <li role="presentation" aria-hidden="true" className={cn("text-muted-foreground/60", className)} {...props}>
    {children ?? <ChevronRight className="h-3.5 w-3.5" />}
  </li>
);
BreadcrumbSeparator.displayName = "BreadcrumbSeparator";
