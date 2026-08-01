"use client";

import * as React from "react";
import type { ChatMessageAttachment } from "@agenticx/core-api";
import { formatFileSize } from "../../utils/format-file-size";

function IconFile({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
      <path d="M10 9H8" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
    </svg>
  );
}

function fileExtLabel(name: string, kind?: ChatMessageAttachment["kind"]): string {
  if (kind === "video") return "VIDEO";
  const ext = name.includes(".") ? name.split(".").pop()?.toUpperCase() : "";
  return ext?.slice(0, 8) ?? "FILE";
}

type UserMessageAttachmentCardProps = {
  attachment: ChatMessageAttachment;
  onPreview?: () => void;
};

/** Neutral file card — separate from the text message bubble. */
export function UserMessageAttachmentCard({ attachment, onPreview }: UserMessageAttachmentCardProps) {
  const canPreview = Boolean(
    (attachment.attachment_id || attachment.parsed_text?.trim()) && onPreview,
  );
  const metaParts = [
    fileExtLabel(attachment.name, attachment.kind),
    formatFileSize(attachment.size),
  ].filter(Boolean);

  return (
    <button
      type="button"
      disabled={!canPreview}
      onClick={(e) => {
        e.stopPropagation();
        onPreview?.();
      }}
      className={[
        "flex w-full max-w-[min(100%,280px)] items-center gap-3 rounded-2xl border border-border/70 bg-card px-3 py-2.5 text-left shadow-sm",
        canPreview ? "cursor-pointer transition-colors hover:bg-muted/60" : "cursor-default",
      ].join(" ")}
    >
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/80 text-muted-foreground">
        <IconFile className="h-5 w-5" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium leading-snug text-foreground">{attachment.name}</div>
        {metaParts.length > 0 ? (
          <div className="mt-0.5 text-xs text-muted-foreground">{metaParts.join(" ")}</div>
        ) : null}
      </div>
    </button>
  );
}
