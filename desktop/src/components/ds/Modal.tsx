import type { ReactNode } from "react";

type Props = {
  open: boolean;
  title?: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
};

export function Modal({ open, title, onClose, children, footer }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/60 p-4">
      <div className="w-[560px] max-w-[92vw] rounded-xl border border-border bg-surface-panel shadow-2xl">
        {(title || onClose) && (
          <div className="flex items-center justify-between border-b border-border px-4 py-2.5">
            <h3 className="text-sm font-semibold text-text-strong">{title}</h3>
            {onClose ? (
              <button className="rounded px-2 py-1 text-xs text-text-subtle hover:bg-surface-hover" onClick={onClose}>
                关闭
              </button>
            ) : null}
          </div>
        )}
        <div className="p-4">{children}</div>
        {footer ? <div className="border-t border-border px-4 py-3">{footer}</div> : null}
      </div>
    </div>
  );
}
