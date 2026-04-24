import * as React from "react";
import { cn } from "../../lib/cn";

/**
 * PageHeader · 页面头部三段式
 *   [面包屑(可选)]
 *   [标题 + 副标题]          [右侧动作按钮区]
 *
 * 用在每个页面顶部，统一视觉节奏。
 */
export interface PageHeaderProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  breadcrumb?: React.ReactNode;
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
}

export const PageHeader = React.forwardRef<HTMLDivElement, PageHeaderProps>(
  ({ breadcrumb, title, description, actions, className, ...props }, ref) => (
    <div ref={ref} className={cn("mb-5 space-y-3", className)} {...props}>
      {breadcrumb}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          {typeof title === "string" ? (
            <h1 className="truncate text-2xl font-semibold leading-tight tracking-tight text-foreground">{title}</h1>
          ) : (
            title
          )}
          {description ? (
            typeof description === "string" ? (
              <p className="text-sm text-muted-foreground">{description}</p>
            ) : (
              description
            )
          ) : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  )
);

PageHeader.displayName = "PageHeader";
