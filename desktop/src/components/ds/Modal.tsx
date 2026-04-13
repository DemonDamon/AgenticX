import type { ReactNode } from "react";

type Props = {
  open: boolean;
  title?: string;
  onClose?: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /** 覆盖默认遮罩（默认 bg-black/60） */
  backdropClassName?: string;
  /**
   * 覆盖默认面板尺寸与背景（默认 w-[560px] max-w-[92vw] bg-surface-panel）。
   * 传入时需自带宽度与背景色，例如：`w-full max-w-[400px] bg-[var(--surface-base-fallback)]`
   */
  panelClassName?: string;
};

export function Modal({ open, title, onClose, children, footer, backdropClassName, panelClassName }: Props) {
  if (!open) return null;
  const backdrop = backdropClassName ?? "bg-black/60";
  const panel =
    panelClassName ??
    "w-[560px] max-w-[92vw] rounded-xl border border-border bg-surface-panel shadow-2xl";
  return (
    <div className={`fixed inset-0 z-modal flex items-center justify-center p-4 ${backdrop}`}>
      <div className={panelClassName ? `rounded-xl border border-border shadow-2xl ${panelClassName}` : panel}>
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
