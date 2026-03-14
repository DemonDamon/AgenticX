import { useEffect, useState } from "react";

type ConfirmPolicy = "ask-every-time" | "use-allowlist" | "run-everything";

type Props = {
  open: boolean;
  question: string;
  sourceLabel?: string;
  diff?: string;
  onApprove: (policy: ConfirmPolicy) => void;
  onReject: (policy: ConfirmPolicy) => void;
};

export function ConfirmDialog({ open, question, sourceLabel, diff, onApprove, onReject }: Props) {
  const [policy, setPolicy] = useState<ConfirmPolicy>("ask-every-time");

  useEffect(() => {
    if (open) setPolicy("ask-every-time");
  }, [open, question]);

  if (!open) {
    return null;
  }
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-w-[90vw] w-[560px] rounded-xl border border-border bg-panel p-4 shadow-2xl">
        <h3 className="mb-2 text-base font-semibold">需要确认</h3>
        {sourceLabel ? <p className="mb-1 text-xs text-slate-400">来源：{sourceLabel}</p> : null}
        <p className="mb-3 break-words text-sm text-slate-200">{question}</p>
        {diff ? (
          <pre className="mb-4 max-h-48 overflow-auto rounded-md border border-border bg-slate-950 p-3 text-xs text-slate-100">
            {diff}
          </pre>
        ) : null}

        <div className="mb-3 rounded-md border border-border/70 bg-slate-900/40 p-3 text-xs text-slate-300">
          <div className="mb-2 font-medium text-slate-200">本次确认策略</div>
          <label className="mb-1 flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="confirm-policy"
              checked={policy === "ask-every-time"}
              onChange={() => setPolicy("ask-every-time")}
              className="h-4 w-4 border-border bg-slate-900 accent-emerald-500"
            />
            Ask Every Time（仅本次允许）
          </label>
          <label className="mb-1 flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="confirm-policy"
              checked={policy === "use-allowlist"}
              onChange={() => setPolicy("use-allowlist")}
              className="h-4 w-4 border-border bg-slate-900 accent-emerald-500"
            />
            Use Allowlist（本会话允许同类）
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="confirm-policy"
              checked={policy === "run-everything"}
              onChange={() => setPolicy("run-everything")}
              className="h-4 w-4 border-border bg-slate-900 accent-amber-500"
            />
            Run Everything（本会话不再询问）
          </label>
        </div>

        <div className="flex justify-end gap-2">
          <button
            className="rounded-lg border border-border px-3 py-1.5 text-sm transition hover:bg-slate-700"
            onClick={() => onReject(policy)}
          >
            取消
          </button>
          <button
            className="rounded-lg bg-emerald-500 px-3 py-1.5 text-sm text-black transition hover:bg-emerald-400"
            onClick={() => onApprove(policy)}
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  );
}
