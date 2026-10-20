"use client";

import * as React from "react";
import type { FeatureUsageState, FeatureUsageWindow } from "@agenticx/config";
import { Alert, AlertDescription, AlertTitle } from "@agenticx/ui";
import { Microscope, SearchX, X } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Remaining search and deep-research allowance.
 *
 * Research shows a count before a run starts. An exhausted search budget is a
 * dismissible notice above the composer.
 */

type WindowLabels = Record<FeatureUsageWindow, string> & { unavailable: string };

const DEFAULT_LABELS: WindowLabels = {
  day: "今日",
  week: "本周",
  month: "本月",
  unavailable: "额度暂不可用",
};

export function featureUsageRemainingText(
  state: FeatureUsageState | null,
  labels: WindowLabels = DEFAULT_LABELS,
): string | null {
  if (state?.unavailable) return labels.unavailable;
  if (!state || state.unlimited || !state.binding) return null;
  const { window, used, limit } = state.binding;
  return `${labels[window]} ${Math.min(used, limit)}/${limit}`;
}

export function isFeatureUsageExhausted(state: FeatureUsageState | null): boolean {
  return Boolean(state && !state.unlimited && state.binding && state.binding.remaining <= 0);
}

function useWindowLabels(): WindowLabels {
  const t = useTranslations("chat.featureUsage");
  return {
    day: t("windowDay"),
    week: t("windowWeek"),
    month: t("windowMonth"),
    unavailable: t("unavailable"),
  };
}

/** Remaining-runs chip beside the deep-research control. Hidden when unlimited. */
export function DeepResearchRemainingBadge({
  state,
}: {
  state: FeatureUsageState | null;
}) {
  const t = useTranslations("chat.featureUsage");
  const text = featureUsageRemainingText(state, useWindowLabels());
  if (!text) return null;
  const exhausted = isFeatureUsageExhausted(state);

  return (
    <span
      data-testid="deep-research-remaining"
      data-exhausted={exhausted ? "true" : "false"}
      title={
        state?.unavailable
          ? t("researchUnavailable")
          : exhausted
            ? t("researchExhausted")
            : t("researchRemainingHint")
      }
      className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium ${
        exhausted
          ? "border-amber-300/60 bg-amber-100/80 text-amber-900 dark:border-amber-500/25 dark:bg-amber-500/10 dark:text-amber-100"
          : "border-border bg-muted/60 text-muted-foreground"
      }`}
    >
      <Microscope className="h-3 w-3" aria-hidden />
      {text}
    </span>
  );
}

/** Dismissible notice once this member's search budget is used up. */
export function SearchQuotaExhaustedNotice({
  state,
  scopeKey,
}: {
  state: FeatureUsageState | null;
  scopeKey: string;
}) {
  const t = useTranslations("chat.featureUsage");
  const labels = useWindowLabels();
  const [dismissedKeys, setDismissedKeys] = React.useState<Set<string>>(() => new Set());

  if (!isFeatureUsageExhausted(state) || !state?.binding) return null;
  const noticeKey = `${scopeKey}:search:${state.binding.window}:${state.binding.limit}`;
  if (dismissedKeys.has(noticeKey)) return null;
  const windowLabel = labels[state.binding.window];

  return (
    <Alert
      role="status"
      aria-live="polite"
      data-testid="search-quota-notice"
      variant="warning"
      className="relative border-amber-300/60 bg-amber-50/90 pr-12 text-amber-950 shadow-sm dark:border-amber-500/35 dark:bg-amber-500/10 dark:text-amber-100"
    >
      <SearchX className="h-5 w-5" />
      <div className="min-w-0">
        <AlertTitle>{t("searchExhaustedTitle", { window: windowLabel })}</AlertTitle>
        <AlertDescription>
          {t("searchExhaustedBody", { limit: state.binding.limit })}
        </AlertDescription>
      </div>
      <button
        type="button"
        aria-label={t("dismissSearchNotice")}
        title={t("dismissSearchNotice")}
        className="absolute right-2.5 top-2.5 inline-flex h-8 w-8 items-center justify-center rounded-lg opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
        onClick={() =>
          setDismissedKeys((current) => {
            const next = new Set(current);
            next.add(noticeKey);
            return next;
          })
        }
      >
        <X className="h-4 w-4" aria-hidden />
      </button>
    </Alert>
  );
}
