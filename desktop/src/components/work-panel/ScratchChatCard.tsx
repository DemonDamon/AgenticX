import { MessageSquare, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "../ds/Button";
import type { ScratchChat, ScratchChatSourceKind } from "../../utils/scratch-chat";

type Props = {
  chat: ScratchChat;
  onClose: () => void;
};

function fileLabel(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || path;
}

function sourceKey(kind: ScratchChatSourceKind): `work.scratchSource.${ScratchChatSourceKind}` {
  return `work.scratchSource.${kind}`;
}

export function ScratchChatCard({ chat, onClose }: Props) {
  const { t } = useTranslation("workspace");
  const quote = String(chat.quotedContent ?? "").trim();
  const files = chat.contextFiles ?? [];

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-panel">
      <div className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-2.5">
        <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-text-subtle" strokeWidth={1.7} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-medium text-text-strong">{chat.title}</div>
          <div className="mt-0.5 text-[11px] text-text-faint">{t(sourceKey(chat.sourceKind))}</div>
        </div>
        <button
          type="button"
          className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text-strong"
          onClick={onClose}
          aria-label={t("work.closeScratchTab")}
        >
          <X className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>

      {chat.floating ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="text-[14px] font-medium text-text-strong">{t("work.scratchFloated")}</div>
          <div className="mt-1 max-w-[240px] text-[12px] leading-relaxed text-text-faint">
            {t("work.scratchFloatedHint")}
          </div>
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
            {quote ? (
              <div className="mb-3">
                <div className="mb-1 text-[11px] text-text-faint">{t("work.scratchQuote")}</div>
                <div className="rounded-md border-l-2 border-border bg-surface-card px-3 py-2 text-[12px] leading-relaxed text-text-subtle">
                  {quote}
                </div>
              </div>
            ) : null}
            {files.length > 0 ? (
              <div className="mb-3">
                <div className="mb-1 text-[11px] text-text-faint">{t("work.scratchFiles")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {files.map((file) => (
                    <span
                      key={file.sourcePath || file.path}
                      className="max-w-full truncate rounded-full bg-surface-card-strong px-2 py-0.5 text-[11px] text-text-muted"
                      title={file.sourcePath || file.path}
                    >
                      {fileLabel(file.sourcePath || file.path)}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="flex min-h-[160px] flex-col items-center justify-center text-center">
              <div className="text-[13px] text-text-subtle">{t("work.scratchEmpty")}</div>
              <div className="mt-1 max-w-[260px] text-[11px] leading-relaxed text-text-faint">
                {t("work.scratchEmptyHint")}
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-end gap-2 border-t border-border px-3 py-2.5">
            <input
              type="text"
              disabled
              placeholder={t("work.scratchComposerPlaceholder")}
              className="min-w-0 flex-1 rounded-md border border-border bg-surface-card px-2.5 py-1.5 text-[13px] text-text-strong outline-none placeholder:text-text-faint disabled:opacity-60"
            />
            <Button variant="primary" disabled>
              {t("work.scratchSend")}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
