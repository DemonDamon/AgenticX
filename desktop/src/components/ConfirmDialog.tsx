import { useEffect, useState } from "react";
import { Button } from "./ds/Button";
import { Modal } from "./ds/Modal";

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

  return (
    <Modal
      open={open}
      title="需要确认"
      footer={(
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onReject(policy)}>
            取消
          </Button>
          <Button variant="primary" onClick={() => onApprove(policy)}>
            确认执行
          </Button>
        </div>
      )}
    >
        {sourceLabel ? <p className="mb-1 text-xs text-text-subtle">来源：{sourceLabel}</p> : null}
        <p className="mb-3 break-words text-sm text-text-primary">{question}</p>
        {diff ? (
          <pre className="mb-4 max-h-48 overflow-auto rounded-md border border-border bg-surface-panel p-3 text-xs text-text-strong">
            {diff}
          </pre>
        ) : null}

        <div className="mb-3 rounded-md border border-border bg-surface-card p-3 text-xs text-text-muted">
          <div className="mb-2 font-medium text-text-primary">本次确认策略</div>
          <label className="mb-1 flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="confirm-policy"
              checked={policy === "ask-every-time"}
              onChange={() => setPolicy("ask-every-time")}
              className="h-4 w-4 border-border bg-surface-panel accent-emerald-500"
            />
            每次询问（仅本次允许）
          </label>
          <label className="mb-1 flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="confirm-policy"
              checked={policy === "use-allowlist"}
              onChange={() => setPolicy("use-allowlist")}
              className="h-4 w-4 border-border bg-surface-panel accent-emerald-500"
            />
            白名单放行（本会话允许同类）
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="confirm-policy"
              checked={policy === "run-everything"}
              onChange={() => setPolicy("run-everything")}
              className="h-4 w-4 border-border bg-surface-panel accent-amber-500"
            />
            全部自动执行（本会话不再询问）
          </label>
        </div>
    </Modal>
  );
}
