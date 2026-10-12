import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { DEFAULT_META_AVATAR_URL } from "../../constants/meta-avatar";
import {
  confirmChatExternalLinkOpen,
  dismissChatExternalLinkPrompt,
  subscribeChatExternalLinkPrompt,
  type ChatExternalLinkPending,
} from "../../utils/chat-external-link";

const SECONDARY_BTN =
  "h-9 w-full rounded-full bg-[var(--surface-card-strong)] text-[13px] font-medium text-text-strong transition hover:bg-[var(--surface-hover)] active:scale-[0.98]";

export function ExternalLinkConfirmDialog() {
  const { t } = useTranslation("chat");
  const [pending, setPending] = useState<ChatExternalLinkPending | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeChatExternalLinkPrompt(setPending), []);
  useEffect(() => {
    setCopied(false);
  }, [pending?.url]);

  if (!pending) return null;

  const url = pending.url;

  return (
    <div className="fixed inset-0 z-modal flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="external-link-confirm-title"
        className="w-[272px] max-w-[calc(100vw-32px)] rounded-[20px] border border-border bg-[var(--surface-base-fallback)] px-5 pb-5 pt-6 shadow-2xl"
      >
        <div className="flex justify-center">
          <img
            src={DEFAULT_META_AVATAR_URL}
            alt=""
            className="h-14 w-14 rounded-[14px] object-cover"
          />
        </div>
        <h3
          id="external-link-confirm-title"
          className="mt-4 text-center text-[15px] font-semibold leading-snug text-text-strong"
        >
          {t("externalLink.title")}
        </h3>
        <p className="mt-2 break-all text-center text-[12px] leading-5 text-text-muted">{url}</p>
        <div className="mt-5 flex flex-col gap-2">
          <button
            type="button"
            className="h-9 w-full rounded-full bg-btnPrimary text-[13px] font-medium text-btnPrimary-text transition hover:bg-btnPrimary-hover active:scale-[0.98]"
            onClick={() => confirmChatExternalLinkOpen()}
          >
            {t("externalLink.open")}
          </button>
          <button
            type="button"
            className={SECONDARY_BTN}
            onClick={() => {
              void navigator.clipboard?.writeText(url).then(
                () => setCopied(true),
                () => setCopied(false),
              );
            }}
          >
            {copied ? t("externalLink.copied") : t("externalLink.copy")}
          </button>
          <button
            type="button"
            className={SECONDARY_BTN}
            onClick={() => confirmChatExternalLinkOpen({ trustHost: true })}
          >
            {t("externalLink.alwaysAllow")}
          </button>
          <button
            type="button"
            className={SECONDARY_BTN}
            onClick={() => dismissChatExternalLinkPrompt()}
          >
            {t("externalLink.cancel")}
          </button>
        </div>
      </div>
    </div>
  );
}
