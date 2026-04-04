import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

type Props = {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  /** 为 true 时标题行可点击展开/收起内容 */
  collapsible?: boolean;
  /** 仅当 collapsible 时生效；true 表示初始为收起 */
  defaultCollapsed?: boolean;
};

export function Panel({
  title,
  actions,
  children,
  className = "",
  collapsible = false,
  defaultCollapsed = false,
}: Props) {
  const [open, setOpen] = useState(!defaultCollapsed);

  if (!collapsible) {
    return (
      <section className={`rounded-lg border border-border bg-surface-card ${className}`}>
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-text-subtle">{title}</h4>
          {actions}
        </header>
        <div className="p-3">{children}</div>
      </section>
    );
  }

  return (
    <section className={`rounded-lg border border-border bg-surface-card ${className}`}>
      <header className="flex items-center justify-between border-b border-border px-3 py-2">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left transition hover:text-text-primary"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          <ChevronDown
            className={`h-3.5 w-3.5 shrink-0 text-text-faint transition-transform ${open ? "" : "-rotate-90"}`}
            aria-hidden
          />
          <h4 className="text-xs font-semibold uppercase tracking-[0.06em] text-text-subtle">{title}</h4>
        </button>
        {actions}
      </header>
      {open ? <div className="p-3">{children}</div> : null}
    </section>
  );
}
