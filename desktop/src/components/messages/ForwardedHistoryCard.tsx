import type { ForwardedHistoryCard as ForwardedHistoryCardData } from "../../store";

type Props = {
  history: ForwardedHistoryCardData;
  onOpen: () => void;
};

export function ForwardedHistoryCard({ history, onOpen }: Props) {
  const preview = history.items.slice(0, 2);
  return (
    <button
      type="button"
      className="box-border w-full min-w-0 max-w-full rounded-lg border border-border bg-surface-panel/70 px-3 py-2 text-left transition hover:bg-surface-hover"
      onClick={onOpen}
    >
      <div className="break-words text-sm font-medium text-text-strong [overflow-wrap:anywhere]">{history.title}</div>
      <div className="mt-2 space-y-1">
        {preview.map((item, index) => (
          <div
            key={`${item.sender}-${index}-${item.content.slice(0, 20)}`}
            className="break-words text-xs text-text-muted [overflow-wrap:anywhere]"
          >
            {item.sender}: {item.content}
          </div>
        ))}
      </div>
      <div className="mt-2 border-t border-border pt-1.5 text-right text-xs text-cyan-300">聊天记录 ▸</div>
    </button>
  );
}
