type Props = {
  text: string;
};

export function ReasoningBlock({ text }: Props) {
  return (
    <details className="rounded-lg border border-border bg-surface-card px-3 py-2 text-xs text-text-subtle">
      <summary className="cursor-pointer select-none text-[11px] uppercase tracking-wide text-text-faint">
        reasoning
      </summary>
      <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-words text-[11px]">{text}</pre>
    </details>
  );
}
