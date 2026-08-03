"use client";

import * as React from "react";
import { useTranslations } from "next-intl";
import { QUOTA_USAGE_CHANGED_EVENT } from "@agenticx/sdk-ts";
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
};

export function QuotaLimitNotice({ forceOpen = false }: QuotaLimitNoticeProps) {
  const t = useTranslations("chat");
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
    if (!forceOpen) return;
    setSummaryExhausted(true);
    exhaustedRef.current = true;
    setDialogOpen(true);
  }, [forceOpen]);

  const showNotice = summaryExhausted || forceOpen;

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
            <AlertTitle>{t("quotaExhaustedTitle")}</AlertTitle>
            <AlertDescription>{t("quotaExhaustedPageNotice")}</AlertDescription>
          </div>
        </Alert>
      ) : null}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md gap-5">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <CircleAlert className="h-5 w-5 text-warning" />
              {t("quotaExhaustedTitle")}
            </DialogTitle>
            <DialogDescription>{t("quotaExhaustedDescription")}</DialogDescription>
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
