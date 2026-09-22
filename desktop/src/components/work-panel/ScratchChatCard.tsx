import { ArrowUp, Maximize2, MessageSquare, Square, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import type { ScratchChat, ScratchChatContextFile, ScratchChatSourceKind } from "../../utils/scratch-chat";
import { resolveScratchChatModel, withoutScratchContextFile } from "../../utils/scratch-chat";
import { lastScratchUserMessage } from "../../utils/scratch-chat-runtime";
import { abortScratchChatTurn } from "./use-scratch-chat-runtime";
import { ScratchChatTranscript } from "./ScratchChatTranscript";
import { ScratchModelPicker } from "./ScratchModelPicker";
import { useScratchPaneMeta } from "./use-scratch-pane-meta";

type Props = {
  chat: ScratchChat;
  paneId?: string;
  onClose: () => void;
  onFloat?: () => void;
  onSend?: (text: string) => Promise<boolean>;
  onRetry?: (userMessageId: string) => void;
  sending?: boolean;
  error?: string;
  hideHeader?: boolean;
};

function fileLabel(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  return normalized.split("/").filter(Boolean).pop() || path;
}

function sourceKey(kind: ScratchChatSourceKind): `work.scratchSource.${ScratchChatSourceKind}` {
  return `work.scratchSource.${kind}`;
}

function ScratchComposerContext({
  quote,
  files,
  onClearQuote,
  onRemoveFile,
}: {
  quote: string;
  files: ScratchChatContextFile[];
  onClearQuote?: () => void;
  onRemoveFile?: (path: string) => void;
}) {
  const { t } = useTranslation("workspace");
  if (!quote && files.length === 0) return null;

  return (
    <div data-slot="scratch-composer-quote" className="mb-2 flex flex-col gap-1.5 border-b border-border/70 pb-2">
      {quote ? (
        <div className="flex min-w-0 items-start gap-2">
          <span className="mt-0.5 w-0.5 shrink-0 self-stretch rounded-full bg-text-faint/50" aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="text-[10px] leading-4 text-text-faint">{t("work.scratchQuote")}</div>
            <div className="line-clamp-3 text-[12px] leading-relaxed text-text-subtle">{quote}</div>
          </div>
          {onClearQuote ? (
            <button
              type="button"
              className="mt-0.5 rounded p-0.5 text-text-faint hover:bg-surface-hover hover:text-text-strong"
              aria-label={t("work.scratchClearQuote")}
              onClick={onClearQuote}
            >
              <X className="h-3 w-3" strokeWidth={2} />
            </button>
          ) : null}
        </div>
      ) : null}
      {files.length > 0 ? (
        <div className="flex flex-wrap gap-1.5 pl-2.5">
          {files.map((file) => {
            const path = file.sourcePath || file.path;
            return (
              <span
                key={path}
                className="inline-flex max-w-full items-center gap-1 rounded-full bg-surface-card-strong py-0.5 pl-2 pr-1 text-[11px] text-text-muted"
                title={path}
              >
                <span className="truncate">{fileLabel(path)}</span>
                {onRemoveFile ? (
                  <button
                    type="button"
                    className="rounded-full p-0.5 text-text-faint hover:bg-surface-hover hover:text-text-strong"
                    aria-label={t("work.scratchRemoveFile", { name: fileLabel(path) })}
                    onClick={() => onRemoveFile(path)}
                  >
                    <X className="h-3 w-3" strokeWidth={2} />
                  </button>
                ) : null}
              </span>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function ScratchChatCard({
  chat,
  paneId,
  onClose,
  onFloat,
  onSend,
  onRetry,
  sending = false,
  error,
  hideHeader = false,
}: Props) {
  const { t } = useTranslation("workspace");
  const [draft, setDraft] = useState("");
  const patchScratchChat = useAppStore((s) => s.patchScratchChat);
  const paneMeta = useScratchPaneMeta(paneId ?? "");
  const resolvedModel = resolveScratchChatModel(chat, paneMeta);
  const quote = String(chat.quotedContent ?? "").trim();
  const files = chat.contextFiles ?? [];
  useEffect(() => {
    if (!paneId || !quote) return;
    const alreadySent = (chat.messages ?? []).some(
      (item) => item.role === "user" && String(item.quotedContent ?? "").trim() === quote,
    );
    if (!alreadySent) return;
    patchScratchChat(paneId, chat.id, { quotedContent: undefined });
  }, [chat.id, chat.messages, paneId, patchScratchChat, quote]);
  const messages = chat.messages ?? [];
  const lastUserId = lastScratchUserMessage(messages)?.id ?? "";
  const showEmpty = messages.length === 0 && !sending;
  const canSend = !sending && Boolean(onSend) && Boolean(draft.trim());
  const canEditContext = Boolean(paneId);

  const submit = async () => {
    const text = draft.trim();
    if (!text || !onSend || sending) return;
    setDraft("");
    const ok = await onSend(text);
    if (!ok) {
      setDraft(text);
      return;
    }
    if (paneId && quote) {
      patchScratchChat(paneId, chat.id, { quotedContent: undefined });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface-panel">
      {!hideHeader ? (
        <div data-slot="scratch-header" className="flex shrink-0 items-start gap-2 border-b border-border px-3 py-2.5">
          <MessageSquare className="mt-0.5 h-4 w-4 shrink-0 text-text-subtle" strokeWidth={1.7} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-text-strong">{chat.title}</div>
            <div className="mt-0.5 text-[11px] text-text-faint">{t(sourceKey(chat.sourceKind))}</div>
          </div>
          {!chat.floating && onFloat ? (
            <button
              type="button"
              className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text-strong"
              onClick={onFloat}
              aria-label={t("work.scratchFloat")}
            >
              <Maximize2 className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          ) : null}
          <button
            type="button"
            className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text-strong"
            onClick={onClose}
            aria-label={t("work.closeScratchTab")}
          >
            <X className="h-3.5 w-3.5" strokeWidth={2} />
          </button>
        </div>
      ) : null}

      {chat.floating ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
          <div className="text-[14px] font-medium text-text-strong">{t("work.scratchFloated")}</div>
          <div className="mt-1 max-w-[240px] text-[12px] leading-relaxed text-text-faint">
            {t("work.scratchFloatedHint")}
          </div>
        </div>
      ) : (
        <>
          {showEmpty ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 text-center">
              <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-border text-text-faint">
                <MessageSquare className="h-5 w-5" strokeWidth={1.6} />
              </div>
              <div className="text-[15px] font-medium text-text-strong">{t("work.scratchEmpty")}</div>
              <div className="mt-1.5 max-w-[220px] text-[12px] leading-relaxed text-text-faint">
                {t("work.scratchEmptyHint")}
              </div>
            </div>
          ) : (
            <ScratchChatTranscript messages={messages} sending={sending} onRetry={onRetry} />
          )}
          {error ? (
            <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-1">
              <div className="min-w-0 text-[11px] leading-relaxed text-rose-400">
                {t("work.scratchSendError", { error })}
              </div>
              {onRetry && lastUserId && !sending ? (
                <button
                  type="button"
                  data-slot="scratch-retry"
                  className="shrink-0 text-[11px] text-text-subtle underline-offset-2 hover:text-text-strong hover:underline"
                  onClick={() => onRetry(lastUserId)}
                >
                  {t("work.scratchRetry")}
                </button>
              ) : null}
            </div>
          ) : null}
          <div className="shrink-0 px-3 pb-3 pt-1">
            <div
              data-slot="scratch-composer"
              className="rounded-[22px] border border-border bg-surface-card px-3 py-2 shadow-sm"
            >
              <ScratchComposerContext
                quote={quote}
                files={files}
                onClearQuote={
                  canEditContext
                    ? () => patchScratchChat(paneId!, chat.id, { quotedContent: undefined })
                    : undefined
                }
                onRemoveFile={
                  canEditContext
                    ? (path) =>
                        patchScratchChat(paneId!, chat.id, {
                          contextFiles: withoutScratchContextFile(chat.contextFiles, path),
                        })
                    : undefined
                }
              />
              <ScratchModelPicker
                provider={resolvedModel.provider}
                model={resolvedModel.model}
                onChange={(provider, nextModel) => {
                  if (!paneId) return;
                  patchScratchChat(paneId, chat.id, { modelProvider: provider, modelName: nextModel });
                }}
              />
              <div className="mt-1.5 flex items-end gap-2">
                <textarea
                  rows={1}
                  value={draft}
                  disabled={!onSend}
                  placeholder={t("work.scratchComposerPlaceholder")}
                  className="max-h-28 min-h-[28px] min-w-0 flex-1 resize-none bg-transparent py-1 text-[13px] leading-relaxed text-text-strong outline-none placeholder:text-text-faint disabled:opacity-60"
                  onChange={(event) => {
                    setDraft(event.target.value);
                    event.target.style.height = "auto";
                    event.target.style.height = `${Math.min(event.target.scrollHeight, 112)}px`;
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      if (sending && paneId) {
                        abortScratchChatTurn(paneId, chat.id);
                        return;
                      }
                      void submit();
                    }
                  }}
                />
                {sending ? (
                  <button
                    type="button"
                    data-slot="scratch-stop"
                    aria-label={t("work.scratchStop")}
                    className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-text-strong text-surface-panel transition hover:opacity-90"
                    onClick={() => {
                      if (paneId) abortScratchChatTurn(paneId, chat.id);
                    }}
                  >
                    <Square className="h-3 w-3" strokeWidth={2.4} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={!canSend}
                    aria-label={t("work.scratchSend")}
                    className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--theme-color-rgb,59,130,246))] text-white transition hover:opacity-90 disabled:opacity-35"
                    onClick={() => void submit()}
                  >
                    <ArrowUp className="h-4 w-4" strokeWidth={2.4} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
