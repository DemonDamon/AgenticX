import { X } from "lucide-react";

type Props = {
  onDismiss?: () => void;
};

export function SecurityRulesGuide({ onDismiss }: Props) {
  return (
    <div
      className="rounded-lg border border-[var(--ui-btn-primary-bg)]/35 bg-[var(--ui-btn-primary-bg)]/8 px-3 py-2.5"
      data-testid="security-rules-guide"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-text-primary">从这里改路径、命令和工具规则</div>
          <p className="mt-1 text-xs leading-5 text-text-subtle">
            上面的运行模式只决定会不会弹确认。要额外拦住某些文件、命令或工具，用下面三块。没有规则就不额外限制。改完立即生效。
          </p>
        </div>
        {onDismiss ? (
          <button
            type="button"
            aria-label="关闭说明"
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-faint transition hover:bg-surface-hover hover:text-text-primary"
            onClick={onDismiss}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        ) : null}
      </div>
    </div>
  );
}
