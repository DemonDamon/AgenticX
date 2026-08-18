"use client";

import * as React from "react";
import { useLocale, useTranslations } from "next-intl";
import { QUOTA_USAGE_CHANGED_EVENT, type ChatQuotaError } from "@agenticx/sdk-ts";
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@agenticx/ui";
import { CircleAlert } from "lucide-react";
import { isQuotaExhausted, type QuotaSummarySnapshot } from "../lib/quota-status";

type QuotaSummaryResponse = {
  data?: QuotaSummarySnapshot;
};

type QuotaLimitNoticeProps = {
  /** Set when the current chat request was rejected with the gateway quota code. */
  forceOpen?: boolean;
  /** Structured day/week/month rejection from the managed gateway. */
  quotaError?: ChatQuotaError | null;
};

export function QuotaLimitNotice({ forceOpen = false, quotaError = null }: QuotaLimitNoticeProps) {
  const t = useTranslations("chat");
  const locale = useLocale();
  const [summaryExhausted, setSummaryExhausted] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const exhaustedRef = React.useRef(false);
  const inFlightRef = React.useRef(false);

  const refresh = React.useCallback(async () => {
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    try {
      const response = await fetch("/api/workspace/quota/summary", { cache: "no-store" });
      const payload = (await response.json().catch(() => ({}))) as QuotaSummaryResponse;
      if (!response.ok || !payload.data) return;

      const nextExhausted = isQuotaExhausted(payload.data);
      setSummaryExhausted(nextExhausted);
      if (nextExhausted && !exhaustedRef.current) setDialogOpen(true);
      exhaustedRef.current = nextExhausted;
    } catch {
      // The chat error path still opens the dialog when the quota endpoint is unavailable.
    } finally {
      inFlightRef.current = false;
    }
  }, []);

  React.useEffect(() => {
    void refresh();
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const intervalId = window.setInterval(refreshWhenVisible, 5_000);
    window.addEventListener(QUOTA_USAGE_CHANGED_EVENT, refreshWhenVisible);
    window.addEventListener("focus", refreshWhenVisible);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener(QUOTA_USAGE_CHANGED_EVENT, refreshWhenVisible);
      window.removeEventListener("focus", refreshWhenVisible);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [refresh]);

  React.useEffect(() => {
    if (!forceOpen && !quotaError) return;
    setDialogOpen(true);
  }, [forceOpen, quotaError]);

  React.useEffect(() => {
    if (!summaryExhausted && !forceOpen && !quotaError) setDialogOpen(false);
  }, [forceOpen, quotaError, summaryExhausted]);

  const showNotice = summaryExhausted || forceOpen || Boolean(quotaError);
  const quotaTitle = quotaError
    ? t(
        quotaError.kind === "token_day"
          ? "quotaDayExhaustedTitle"
          : quotaError.kind === "token_week"
            ? "quotaWeekExhaustedTitle"
            : "quotaMonthExhaustedTitle",
      )
    : t("quotaExhaustedTitle");
  const quotaDescription = React.useMemo(() => {
    if (!quotaError) return t("quotaExhaustedDescription");
    const lines = [t("quotaWindowExhaustedDescription")];
    if (quotaError.period) {
      lines.push(t("quotaPeriodDetail", { period: quotaError.period }));
    }
    if (quotaError.used !== undefined && quotaError.limit !== undefined) {
      const number = new Intl.NumberFormat(locale);
      lines.push(
        t("quotaUsageDetail", {
          used: number.format(quotaError.used),
          limit: number.format(quotaError.limit),
        }),
      );
    }
    if (quotaError.resetAt) {
      const resetAt = new Date(quotaError.resetAt);
      if (!Number.isNaN(resetAt.valueOf())) {
        lines.push(
          t("quotaResetAt", {
            time: new Intl.DateTimeFormat(locale, {
              dateStyle: "medium",
              timeStyle: "short",
            }).format(resetAt),
          }),
        );
      }
    }
    return lines.join("\n");
  }, [locale, quotaError, t]);
  const pageNotice = quotaError ? quotaDescription : t("quotaExhaustedPageNotice");

  return (
    <>
      {showNotice ? (
        <Alert
          variant="warning"
          role="status"
          aria-live="polite"
          className="border-amber-300/60 bg-amber-50/90 text-amber-950 shadow-sm dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100"
        >
          <CircleAlert className="h-5 w-5" />
          <div>
            <AlertTitle>{quotaTitle}</AlertTitle>
            <AlertDescription className="whitespace-pre-line">{pageNotice}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md gap-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleAlert className="h-5 w-5 text-warning" />
              {quotaTitle}
            </DialogTitle>
            <DialogDescription className="whitespace-pre-line">{quotaDescription}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" onClick={() => setDialogOpen(false)}>
              {t("quotaExhaustedAcknowledge")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
