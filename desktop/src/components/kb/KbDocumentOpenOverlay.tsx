import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Loader2 } from "lucide-react";
import {
  getKbDocumentOpenOverlaySnapshot,
  subscribeKbDocumentOpenOverlay,
} from "../../utils/kb-document-open-overlay";

export function KbDocumentOpenOverlay() {
  const state = useSyncExternalStore(
    subscribeKbDocumentOpenOverlay,
    getKbDocumentOpenOverlaySnapshot,
    getKbDocumentOpenOverlaySnapshot,
  );

  if (!state?.visible) return null;

  const label =
    state.status === "error"
      ? state.error || "打开失败"
      : `加载文件 ${state.percent}%`;

  return createPortal(
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/45 backdrop-blur-[2px]"
      role="status"
      aria-live="polite"
      aria-busy={state.status === "loading"}
    >
      <div className="min-w-[220px] rounded-2xl border border-border-subtle bg-surface-card px-8 py-7 text-center shadow-[0_12px_40px_rgba(0,0,0,0.45)]">
        {state.status === "loading" ? (
          <Loader2
            className="mx-auto h-11 w-11 animate-spin text-[rgb(var(--theme-color-rgb))]"
            aria-hidden
          />
        ) : (
          <span
            className="mx-auto inline-flex h-11 w-11 items-center justify-center rounded-full text-lg"
            style={{
              backgroundColor: "var(--kb-citation-bg-muted)",
              color: "var(--kb-citation-fg)",
            }}
            aria-hidden
          >
            !
          </span>
        )}
        <p className="mt-4 text-[13px] font-medium text-text-strong">{label}</p>
        {state.title && state.status === "loading" ? (
          <p className="mt-1 max-w-[260px] truncate text-[11px] text-text-faint" title={state.title}>
            {state.title}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
