import type { ReactNode } from "react";

type Props = {
  title: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
};

export function Panel({ title, actions, children, className = "" }: Props) {
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
