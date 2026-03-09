import { useEffect, useState } from "react";

type Props = {
  open: boolean;
  question: string;
  sourceLabel?: string;
  diff?: string;
  onApprove: (allowSimilar: boolean) => void;
  onReject: () => void;
};

export function ConfirmDialog({ open, question, sourceLabel, diff, onApprove, onReject }: Props) {
  const [allowSimilar, setAllowSimilar] = useState(false);

  useEffect(() => {
    if (open) setAllowSimilar(false);
  }, [open, question]);

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
        <label className="mb-3 flex cursor-pointer items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={allowSimilar}
            onChange={(e) => setAllowSimilar(e.target.checked)}
            className="h-4 w-4 rounded border-border bg-slate-900 accent-emerald-500"
          />
          本次会话自动允许同类操作
        </label>
        <div className="flex justify-end gap-2">
          <button className="rounded-lg border border-border px-3 py-1.5 text-sm transition hover:bg-slate-700" onClick={onReject}>
            取消
          </button>
          <button
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm text-black transition hover:bg-emerald-400"
            onClick={() => onApprove(allowSimilar)}
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  );
}
