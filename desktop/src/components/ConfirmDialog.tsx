type Props = {
  open: boolean;
  question: string;
  diff?: string;
  onApprove: () => void;
  onReject: () => void;
};

export function ConfirmDialog({ open, question, diff, onApprove, onReject }: Props) {
  if (!open) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
      <div className="w-[560px] rounded-xl border border-border bg-panel p-4 shadow-2xl">
        <h3 className="mb-2 text-lg font-semibold">需要确认</h3>
        <p className="mb-3 text-sm text-slate-200">{question}</p>
        {diff ? (
          <pre className="mb-4 max-h-64 overflow-auto rounded-md border border-border bg-slate-950 p-3 text-xs text-slate-100">
            {diff}
          </pre>
        ) : null}
        <div className="flex justify-end gap-2">
          <button className="rounded-md border border-border px-3 py-1.5 text-sm" onClick={onReject}>
            取消
          </button>
          <button className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm text-black" onClick={onApprove}>
            确认执行
          </button>
        </div>
      </div>
    </div>
  );
}
