"use client";

import * as React from "react";
import { Button } from "@agenticx/ui";
import {
  hostnameFromUrl,
  siteLabelFromSource,
  SharedAssistantMarkdown,
  WebSearchFavicon,
  WebSearchSourcesPanel,
} from "@agenticx/feature-chat";
import { ChevronRight, Image, Link2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { ENTERPRISE_PRODUCT_NAME } from "../EnterpriseBrandMark";
import type { ChatShareMessage, ChatShareSnapshot } from "../../lib/chat-share-types";
import { copyText } from "../../lib/chat-share-client";
import { downloadShareImage } from "./share-image";
import { navigateToExternalLink } from "../../lib/external-link";

function SharedAssistantContent({
  message,
  onOpenExternalUrl,
}: {
  message: ChatShareMessage;
  onOpenExternalUrl: (url: string, title?: string) => void;
}) {
  return (
    <SharedAssistantMarkdown
      text={message.content}
      sources={message.web_search_sources}
      onOpenExternalUrl={onOpenExternalUrl}
    />
  );
}

function SharedSearchSourcesButton({
  message,
  onOpen,
  label,
}: {
  message: ChatShareMessage;
  onOpen: () => void;
  label: string;
}) {
  const sources = message.web_search_sources;
  if (!sources?.length) return null;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onOpen();
      }}
      className="mb-3 inline-flex max-w-full items-center gap-2 rounded-full border border-border/60 bg-muted/50 py-1 pl-1.5 pr-2.5 text-sm leading-5 text-foreground/80 transition-colors hover:border-border hover:bg-muted hover:text-foreground"
    >
      <span className="flex items-center -space-x-1.5">
        {sources.slice(0, 3).map((source, index) => {
          const host = hostnameFromUrl(source.url) ?? "";
          const siteLabel = siteLabelFromSource(source, index + 1);
          return (
            <span
              key={`${message.id}-source-${index}`}
              className="flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border border-background bg-background shadow-sm"
            >
              {host ? (
                <WebSearchFavicon host={host} label={siteLabel} size={16} rounded="full" />
              ) : null}
            </span>
          );
        })}
      </span>
      <span className="truncate font-medium">{label}</span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function SharedConversationView({ snapshot }: { snapshot: ChatShareSnapshot }) {
  const t = useTranslations("chat");
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [sourcesPanelMessageId, setSourcesPanelMessageId] = React.useState<string | null>(null);
  const requestExternalLink = React.useCallback((url: string, title?: string) => {
    navigateToExternalLink(url, title);
  }, []);

  const copyLink = async () => {
    try {
      await copyText(window.location.href);
      setStatus(t("shareLinkCopied"));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : t("shareFailed"));
    }
  };

  const generateImage = async () => {
    setBusy(true);
    setStatus(null);
    try {
      await downloadShareImage(snapshot);
      setStatus(t("shareImageDownloaded"));
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") return;
      setStatus(error instanceof Error ? error.message : t("shareFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6">
      <div className="mx-auto max-w-3xl">
        <header className="mb-8 border-b border-border/70 pb-6">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
            <Sparkles className="h-4 w-4" />
            {t("sharePageBrand", { product: ENTERPRISE_PRODUCT_NAME })}
          </div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{snapshot.title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {new Date(snapshot.created_at).toLocaleString("zh-CN")}
          </p>
        </header>

        <div className="space-y-5">
          {snapshot.messages.map((message) => {
            const isUser = message.role === "user";
            return (
              <article key={message.id} className={isUser ? "ml-auto max-w-[88%]" : "max-w-full"}>
                <div
                  className={
                    isUser
                      ? "rounded-2xl rounded-tr-md bg-primary px-5 py-4 text-primary-foreground shadow-sm"
                      : "rounded-2xl border border-border/70 bg-card px-5 py-4 shadow-sm"
                  }
                >
                  <div className={isUser ? "mb-2 text-xs font-semibold text-primary-foreground/75" : "mb-2 text-xs font-semibold text-muted-foreground"}>
                    {isUser ? t("shareUserMessage") : t("shareAssistantMessage")}
                  </div>
                  {!isUser ? (
                    <>
                      <SharedSearchSourcesButton
                        message={message}
                        onOpen={() => setSourcesPanelMessageId(message.id)}
                        label={t("shareSearchResults", { count: message.web_search_sources?.length ?? 0 })}
                      />
                      <SharedAssistantContent
                        message={message}
                        onOpenExternalUrl={requestExternalLink}
                      />
                    </>
                  ) : (
                    <p className="whitespace-pre-wrap break-words text-base leading-7">{message.content}</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>

        <WebSearchSourcesPanel
          open={sourcesPanelMessageId != null}
          onOpenChange={(open) => {
            if (!open) setSourcesPanelMessageId(null);
          }}
          sources={snapshot.messages.find((message) => message.id === sourcesPanelMessageId)?.web_search_sources ?? []}
          onOpenExternalUrl={requestExternalLink}
        />

        <div className="sticky bottom-4 z-30 isolate mt-10 flex flex-wrap items-center justify-center gap-2 overflow-hidden rounded-2xl border border-border/70 bg-background/95 p-3 shadow-2xl backdrop-blur-2xl backdrop-saturate-150">
          <Button type="button" variant="outline" onClick={() => void generateImage()} disabled={busy}>
            <Image className="h-4 w-4" />
            {t("shareGenerateImage")}
          </Button>
          <Button type="button" onClick={() => void copyLink()}>
            <Link2 className="h-4 w-4" />
            {t("shareCopyLink")}
          </Button>
          <span className="basis-full text-center text-xs text-muted-foreground" aria-live="polite">
            {status}
          </span>
        </div>
      </div>
    </main>
  );
}
