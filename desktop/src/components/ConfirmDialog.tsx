type Props = {
  open: boolean;
  question: string;
  sourceLabel?: string;
  diff?: string;
  onApprove: () => void;
  onReject: () => void;
};

export function ConfirmDialog({ open, question, sourceLabel, diff, onApprove, onReject }: Props) {
  if (!open) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-w-[90vw] w-[480px] rounded-xl border border-border bg-panel p-4 shadow-2xl">
        <h3 className="mb-2 text-base font-semibold">需要确认</h3>
        {sourceLabel ? <p className="mb-1 text-xs text-slate-400">来源：{sourceLabel}</p> : null}
        <p className="mb-3 break-words text-sm text-slate-200">{question}</p>
        {diff ? (
          <pre className="mb-4 max-h-48 overflow-auto rounded-md border border-border bg-slate-950 p-3 text-xs text-slate-100">
            {diff}
          </pre>
        ) : null}
        <div className="flex justify-end gap-2">
          <button className="rounded-lg border border-border px-3 py-1.5 text-sm transition hover:bg-slate-700" onClick={onReject}>
            取消
          </button>
          <button className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm text-black transition hover:bg-emerald-400" onClick={onApprove}>
            确认执行
          </button>
        </div>
      </div>
    </div>
  );
}
