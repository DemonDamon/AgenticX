import { FileText, FolderOpen } from "lucide-react";

export type PreviewFallbackProps = {
  title: string;
  message: string;
  mimeType?: string;
  onCopyPath: () => void;
  onRevealInFileManager?: (absolutePath: string) => void;
  revealInFileManagerLabel?: string;
  absolutePath: string;
};

export function PreviewFallback({
  title,
  message,
  mimeType,
  onCopyPath,
  onRevealInFileManager,
  revealInFileManagerLabel,
  absolutePath,
}: PreviewFallbackProps) {
  return (
    <div className="flex h-full min-h-[220px] flex-col items-center justify-center gap-4 bg-surface-base px-8 py-10 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-[var(--border-subtle)] bg-surface-popover">
        <FileText className="h-7 w-7 text-text-muted" strokeWidth={1.5} />
      </div>
      <div className="max-w-sm space-y-2">
        <div className="text-sm font-medium text-text-strong">{title}</div>
        <p className="text-[13px] leading-relaxed text-text-muted">{message}</p>
        {mimeType ? <p className="text-[11px] text-text-faint">{mimeType}</p> : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <button
          type="button"
          className="rounded-md border border-[var(--border-subtle)] bg-surface-popover px-3 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-hover"
          onClick={onCopyPath}
        >
          复制路径
        </button>
        {onRevealInFileManager ? (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border-subtle)] bg-surface-popover px-3 py-1.5 text-xs text-text-primary transition-colors hover:bg-surface-hover"
            onClick={() => onRevealInFileManager(absolutePath)}
          >
            <FolderOpen className="h-3.5 w-3.5" strokeWidth={1.5} />
            {revealInFileManagerLabel ?? "在文件管理器中显示"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
