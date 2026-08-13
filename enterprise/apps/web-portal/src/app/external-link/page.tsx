"use client";

import * as React from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ExternalLink, ShieldAlert } from "lucide-react";
import { Button } from "@agenticx/ui";
import { EnterpriseBrandMark } from "../../components/EnterpriseBrandMark";

type ExternalTarget = {
  href: string;
  title: string;
  host: string;
};

function parseTarget(raw: string | null, title: string | null): ExternalTarget | null {
  if (!raw) return null;
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return {
      href: parsed.href,
      title: title?.trim() || parsed.href,
      host: parsed.host,
    };
  } catch {
    return null;
  }
}

function ExternalLinkPageContent() {
  const searchParams = useSearchParams();
  const target = React.useMemo(
    () => parseTarget(searchParams.get("url"), searchParams.get("title")),
    [searchParams],
  );
  const goBack = React.useCallback(() => {
    window.close();
    // Script-opened tabs normally close synchronously. Keep a safe fallback
    // for browsers that block window.close() or for directly opened URLs.
    window.setTimeout(() => {
      if (window.closed) return;
      if (window.history.length > 1) {
        window.history.back();
      } else {
        window.location.replace("/workspace");
      }
    }, 100);
  }, []);

  const continueToExternalSite = React.useCallback(() => {
    if (!target) return;
    window.location.replace(target.href);
  }, [target]);

  return (
    <main className="min-h-screen bg-background px-4 py-8 text-foreground sm:px-6 sm:py-12">
      <div className="mx-auto flex min-h-[calc(100vh-6rem)] w-full max-w-2xl flex-col justify-center">
        <div className="mb-6 flex items-center gap-3 px-1">
          <EnterpriseBrandMark size={40} />
          <span className="text-lg font-semibold tracking-tight">和创智派</span>
        </div>

        <section className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-[0_24px_80px_rgba(15,23,42,0.10)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.28)]">
          <div className="border-b border-border/70 bg-muted/25 px-6 py-7 sm:px-10 sm:py-9">
            <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-2xl bg-amber-500/12 text-amber-600 dark:text-amber-400">
              <ShieldAlert className="h-6 w-6" />
            </div>
            <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">即将打开外部网页</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground sm:text-base">
              你即将离开当前工作区并访问外部网站。请确认链接地址后再继续。
            </p>
          </div>

          <div className="space-y-5 px-6 py-6 sm:px-10 sm:py-8">
            {target ? (
              <div className="rounded-2xl border border-border/70 bg-background px-4 py-4 sm:px-5">
                <div className="flex min-w-0 items-start gap-3">
                  <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ExternalLink className="h-4 w-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-xs font-medium text-muted-foreground">目标网站</p>
                    <p className="mt-1 truncate text-sm font-semibold text-foreground">{target.host}</p>
                    <p className="mt-2 break-all text-xs leading-5 text-muted-foreground">{target.title}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-danger/30 bg-danger/5 px-4 py-4 text-sm leading-6 text-danger">
                当前外链无效或已过期，请返回对话后重新点击引用。
              </div>
            )}

            <p className="text-xs leading-5 text-muted-foreground">
              外部网页的内容和安全性由目标网站负责，请不要在不熟悉的网站中输入敏感信息。
            </p>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" onClick={goBack}>
                <ArrowLeft className="h-4 w-4" />
                返回对话
              </Button>
              <Button type="button" onClick={continueToExternalSite} disabled={!target}>
                <ExternalLink className="h-4 w-4" />
                继续访问
              </Button>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default function ExternalLinkPage() {
  return (
    <React.Suspense fallback={null}>
      <ExternalLinkPageContent />
    </React.Suspense>
  );
}
