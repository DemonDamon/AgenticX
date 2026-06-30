import { useEffect, useState } from "react";
import { Button } from "./ds/Button";
import { Modal } from "./ds/Modal";

export type ClarificationAnswer = {
  answerText: string;
  selectedOptions: string[];
};

type Props = {
  open: boolean;
  prompt: string;
  options?: string[];
  allowFreeText?: boolean;
  sourceLabel?: string;
  context?: Record<string, unknown> | undefined;
  onSubmit: (answer: ClarificationAnswer) => void;
  onSkip: () => void;
};

export function ClarificationDialog({
  open,
  prompt,
  options,
  allowFreeText,
  sourceLabel,
  context,
  onSubmit,
  onSkip,
}: Props) {
  const opts = Array.isArray(options) ? options.filter((o) => typeof o === "string" && o.trim()) : [];
  const canFreeText = allowFreeText !== false;
  const [selected, setSelected] = useState<string | null>(null);
  const [useCustom, setUseCustom] = useState(false);
  const [text, setText] = useState("");

  useEffect(() => {
    if (open) {
      setSelected(opts.length > 0 ? null : null);
      setUseCustom(false);
      setText("");
    }
  }, [open, prompt, opts.length]);

  const canSubmit = canFreeText && useCustom ? text.trim().length > 0 : selected !== null;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onSubmit({
      answerText: useCustom ? text.trim() : "",
      selectedOptions: selected && !useCustom ? [selected] : [],
    });
  };

  return (
    <Modal
      open={open}
      title="需要你的输入"
      footer={
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onSkip}>
            跳过（按默认推进）
          </Button>
          <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit}>
            提交
          </Button>
        </div>
      }
    >
      {sourceLabel ? <p className="mb-1 text-xs text-text-subtle">来源：{sourceLabel}</p> : null}
      <p className="mb-3 break-words text-sm text-text-primary whitespace-pre-wrap">{prompt}</p>

      {opts.length > 0 ? (
        <div className="mb-3 flex flex-col gap-1.5">
          {opts.map((opt) => {
            const active = !useCustom && selected === opt;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => {
                  setUseCustom(false);
                  setSelected(opt);
                }}
                className={
                  "rounded-md border px-3 py-2 text-left text-sm transition-colors " +
                  (active
                    ? "border-[var(--ui-btn-primary-bg,--ui-accent)] bg-surface-hover text-text-strong"
                    : "border-border bg-surface-card text-text-primary hover:bg-surface-hover")
                }
              >
                {opt}
              </button>
            );
          })}
        </div>
      ) : null}

      {canFreeText ? (
        <div className="mb-2 rounded-md border border-border bg-surface-card p-3 text-xs text-text-muted">
          <label className="mb-1.5 flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={useCustom}
              onChange={(e) => {
                setUseCustom(e.target.checked);
                if (e.target.checked) setSelected(null);
              }}
              className="h-4 w-4 border-border bg-surface-panel accent-emerald-500"
            />
            自定义回复
          </label>
          {useCustom ? (
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="输入你的回复…"
              rows={4}
              className="mt-1 w-full resize-y rounded-md border border-border bg-surface-panel p-2 text-sm text-text-primary outline-none focus:border-[var(--ui-btn-primary-bg,--ui-accent)]"
            />
          ) : null
          }
        </div>
      ) : null}

      {context && Object.keys(context).length > 0 ? (
        <details className="mt-2 text-xs text-text-subtle">
          <summary className="cursor-pointer">附加上下文</summary>
          <pre className="mt-1 max-h-40 overflow-auto rounded-md border border-border bg-surface-panel p-2 text-[11px] text-text-muted">
            {JSON.stringify(context, null, 2)}
          </pre>
        </details>
      ) : null}
    </Modal>
  );
}
