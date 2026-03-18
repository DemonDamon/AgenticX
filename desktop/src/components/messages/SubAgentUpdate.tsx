type Props = {
  text: string;
};

export function SubAgentUpdate({ text }: Props) {
  return (
    <div className="rounded-lg border border-border bg-surface-card px-3 py-1.5 text-[11px] text-status-warning">
      {text}
    </div>
  );
}
