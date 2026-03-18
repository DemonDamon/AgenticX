type Props = {
  question: string;
};

export function InlineConfirmCard({ question }: Props) {
  return (
    <div className="rounded-lg border border-status-warning/50 bg-status-warning/10 px-3 py-2 text-xs text-status-warning">
      等待确认: {question}
    </div>
  );
}
