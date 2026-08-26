import { useEffect, useState } from "react";
import { Button } from "./ds/Button";
import { Modal } from "./ds/Modal";
import { CONFIRM_DIALOG_POLICY_OPTIONS } from "../constants/confirm-strategy-options";
import {
  canReuseConfirmPolicy,
  isProtectedConfirmContext,
  protectedConfirmReason,
  type ConfirmPolicy,
} from "../utils/confirm-scope";

type Props = {
  open: boolean;
  question: string;
  sourceLabel?: string;
  diff?: string;
  context?: Record<string, unknown>;
  defaultPolicy?: ConfirmPolicy;
  onApprove: (policy: ConfirmPolicy) => void;
  onReject: (policy: ConfirmPolicy) => void;
};

const POLICY_OPTIONS: Array<{ value: ConfirmPolicy; label: string }> = [
  ...CONFIRM_DIALOG_POLICY_OPTIONS,
];

export function ConfirmDialog({
  open,
  question,
  sourceLabel,
  diff,
  context,
  defaultPolicy = "ask-every-time",
  onApprove,
  onReject,
}: Props) {
  const [policy, setPolicy] = useState<ConfirmPolicy>("ask-every-time");
  const protectedRequest = isProtectedConfirmContext(context);
  const lockToOnce = !canReuseConfirmPolicy(context);
  const protectedReason = protectedConfirmReason(context);
  const autoModeInterrupted = lockToOnce && defaultPolicy === "run-everything";
  const policyOptions = lockToOnce
    ? POLICY_OPTIONS.filter((option) => option.value === "ask-every-time")
    : POLICY_OPTIONS;

  useEffect(() => {
    if (open) setPolicy(lockToOnce ? "ask-every-time" : defaultPolicy);
  }, [defaultPolicy, open, lockToOnce, question]);

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
          {lockToOnce && protectedRequest ? (
            <p className="mb-2 rounded bg-amber-500/10 px-2 py-1.5 leading-5 text-[var(--status-warning)]">
              {autoModeInterrupted ? "已选全部允许，但这一步仍需确认：" : "这是受保护操作："}
              {protectedReason}。只能逐次确认，不能加入同类允许或自动执行。
            </p>
          ) : null}
          {policyOptions.map((option) => (
            <label key={option.value} className="mb-1 flex cursor-pointer items-center gap-2 last:mb-0">
              <input
                type="radio"
                name="confirm-policy"
                checked={policy === option.value}
                onChange={() => setPolicy(option.value)}
                className={`h-4 w-4 border-border bg-surface-panel ${
                  option.value === "run-everything" ? "accent-amber-500" : "accent-emerald-500"
                }`}
              />
              {option.label}
            </label>
          ))}
        </div>
    </Modal>
  );
}
