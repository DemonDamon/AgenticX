"use client";

import React, { useState } from "react";
import { Button } from "@agenticx/ui";
import { useTranslations } from "next-intl";

const REVIEWS = ["running", "pending", "approved", "failed", "cancelled", "discarded"] as const;
type DreamReview = (typeof REVIEWS)[number];

function asReview(value: string): DreamReview | null {
  if ((REVIEWS as readonly string[]).includes(value)) return value as DreamReview;
  return null;
}

export function DreamReviewBanner({
  review,
  confirming = false,
  onApprove,
  onDiscard,
}: {
  review: string;
  confirming?: boolean;
  onApprove: () => void;
  onDiscard: () => void;
}) {
  const t = useTranslations("pages.admin.agentMemory.dream.review");
  const [openConfirm, setOpenConfirm] = useState(confirming);
  const parsed = asReview(review);
  if (!parsed) return null;

  let message = "";
  switch (parsed) {
    case "running":
      message = t("running");
      break;
    case "pending":
      message = t("pending");
      break;
    case "approved":
      message = t("approved");
      break;
    case "failed":
    case "cancelled":
    case "discarded":
      message = t("archived");
      break;
    default: {
      const unreachable: never = parsed;
      return unreachable;
    }
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-muted/40 p-3 text-sm">
      <p>{message}</p>
      {parsed === "pending" ? (
        <div className="mt-3 flex gap-2">
          <Button type="button" onClick={onApprove}>{t("approve")}</Button>
          <Button type="button" variant="outline" onClick={() => setOpenConfirm(true)}>{t("discard")}</Button>
        </div>
      ) : null}
      {parsed === "pending" && openConfirm ? (
        <div role="dialog" aria-modal="true" className="mt-3 rounded-xl border border-border bg-popover p-4 text-popover-foreground">
          <p className="font-medium">{t("discardTitle")}</p>
          <p className="mt-2">{t("discardDescription")}</p>
          <div className="mt-3 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpenConfirm(false)}>{t("cancel")}</Button>
            <Button type="button" onClick={onDiscard}>{t("discard")}</Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
