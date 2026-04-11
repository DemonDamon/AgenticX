import type { ForwardedHistoryCard as ForwardedHistoryCardData } from "../../store";

type Props = {
  open: boolean;
  history?: ForwardedHistoryCardData;
  onClose: () => void;
};

function formatTime(ts?: number): string {
  if (!ts) return "";
  try {
    return new Date(ts).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "";
  }
}

export function ForwardedHistoryModal({ open, history, onClose }: Props) {
  if (!open || !history) return null;
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface-panel shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="text-sm font-semibold text-text-strong">{history.title}</div>
          <button
            type="button"
            className="rounded px-2 py-1 text-xs text-text-subtle transition hover:bg-surface-hover hover:text-text-strong"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        <div className="space-y-3 overflow-y-auto px-4 py-3">
          {history.note ? (
            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-sm text-cyan-200">
              <div className="mb-1 text-xs font-medium text-cyan-300">附加说明</div>
              <div className="whitespace-pre-wrap break-words">{history.note}</div>
            </div>
          ) : null}
          {history.items.map((item, index) => (
            <div key={`${item.sender}-${index}-${item.content.slice(0, 20)}`} className="rounded-lg border border-border bg-surface-card px-3 py-2">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs text-text-faint">
                <span className="font-medium text-text-muted">{item.sender}</span>
                <span>{formatTime(item.timestamp)}</span>
              </div>
              <div className="whitespace-pre-wrap break-words text-sm text-text-primary">{item.content}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
