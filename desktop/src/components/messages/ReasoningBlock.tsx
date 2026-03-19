type Props = {
  text: string;
  streaming?: boolean;
};

function Spinner() {
  return (
    <span className="relative mr-1.5 inline-flex h-2.5 w-2.5 align-middle">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full opacity-30" style={{ background: "var(--text-faint)" }} />
      <span className="relative inline-flex h-2.5 w-2.5 rounded-full opacity-70" style={{ background: "var(--text-faint)" }} />
    </span>
  );
}

export function ReasoningBlock({ text, streaming = false }: Props) {
  if (streaming) {
    return (
      <div className="mb-1 text-xs text-text-subtle">
        <div className="flex items-center gap-1 text-[11px] font-medium tracking-wide text-text-faint">
          <Spinner />
          <span>Thinking</span>
        </div>
        {text ? (
          <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-faint">{text}</pre>
        ) : null}
      </div>
    );
  }
  return (
    <details className="mb-1 text-xs text-text-subtle">
      <summary className="cursor-pointer select-none text-[11px] font-medium tracking-wide text-text-faint">
        Thought
      </summary>
      <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-words text-[11px] leading-relaxed text-text-faint">{text}</pre>
    </details>
  );
}
