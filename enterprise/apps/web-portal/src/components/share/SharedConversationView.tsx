"use client";

import * as React from "react";
import { Button } from "@agenticx/ui";
import { Image, Link2, Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { ENTERPRISE_PRODUCT_NAME } from "../EnterpriseBrandMark";
import type { ChatShareSnapshot } from "../../lib/chat-share-types";
import { copyText } from "../../lib/chat-share-client";
import { shareOrDownloadImage } from "./share-image";

export function SharedConversationView({ snapshot }: { snapshot: ChatShareSnapshot }) {
  const t = useTranslations("chat");
  const [status, setStatus] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

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
      const result = await shareOrDownloadImage(snapshot);
      setStatus(result === "shared" ? t("shareImageShared") : t("shareImageDownloaded"));
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
                  <p className="whitespace-pre-wrap break-words text-[15px] leading-7">{message.content}</p>
                  {message.web_search_sources?.length ? (
                    <div className="mt-4 border-t border-current/10 pt-3">
                      <p className="mb-2 text-xs font-semibold opacity-70">{t("shareSources")}</p>
                      <div className="space-y-1.5">
                        {message.web_search_sources.slice(0, 10).map((source, index) => (
                          <a
                            key={`${message.id}-${source.url}-${index}`}
                            href={source.url}
                            target="_blank"
                            rel="noreferrer"
                            className="flex min-w-0 items-center gap-2 rounded-md bg-muted/45 px-2 py-1.5 text-xs opacity-80 hover:opacity-100"
                          >
                            <span className="inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-background px-1.5 font-mono text-[10px] font-semibold text-muted-foreground">
                              {index + 1}
                            </span>
                            <span className="min-w-0 truncate underline underline-offset-2">
                              {source.title || source.url}
                            </span>
                          </a>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>

        <div className="sticky bottom-4 mt-10 flex flex-wrap items-center justify-center gap-2 rounded-2xl border border-border/70 bg-background/90 p-3 shadow-lg backdrop-blur">
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
