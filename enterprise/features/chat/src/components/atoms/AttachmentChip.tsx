"use client";

import * as React from "react";
import { Button } from "@agenticx/ui";
import type { ComposerAttachment } from "../../types/composer-attachment";
import { formatFileSize } from "../../utils/format-file-size";

function IconX({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

function IconFile({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
      <path d="M14 2v4a2 2 0 0 0 2 2h4" />
    </svg>
  );
}

type AttachmentChipProps = {
  file: ComposerAttachment;
  onRemove: () => void;
};

export function kindBadge(file: ComposerAttachment): string {
  if (file.kind === "video") return "VID";
  if (file.kind === "document") {
    const ext = file.name.includes(".") ? file.name.split(".").pop()?.toUpperCase() : "DOC";
    return (ext ?? "DOC").slice(0, 4);
  }
  return "IMG";
}

/** Status / meta line under the filename (progress, waiting, type+size). */
export function attachmentChipStatusLabel(file: ComposerAttachment): string {
  if (file.status === "uploading") return `${file.uploadProgress ?? 0}%`;
  if (file.status === "parsing") return "等待解析";
  if (file.status === "error") return file.errorText ?? "失败";
  if (file.kind === "video") return "视频（仅文件名）";
  return [kindBadge(file), formatFileSize(file.size)].filter(Boolean).join(" ");
}

export function AttachmentChip({ file, onRemove }: AttachmentChipProps) {
  const isImage = file.kind === "image" || (!!file.dataUrl && file.mimeType.startsWith("image/"));
  const showSpinner = file.status === "uploading" || file.status === "parsing";
  return (
    <div className="group relative inline-flex max-w-[260px] items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted/40">
      {isImage && file.dataUrl ? (
        <img src={file.dataUrl} alt={file.name} className="h-10 w-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-10 w-10 shrink-0 flex-col items-center justify-center rounded-lg bg-primary/10 text-primary">
          <IconFile className="h-4 w-4" />
          <span className="mt-0.5 text-[9px] font-semibold leading-none">{kindBadge(file)}</span>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium leading-tight">{file.name}</div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {showSpinner ? (
            <span
              className="inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden
            />
          ) : null}
          <span>{attachmentChipStatusLabel(file)}</span>
        </div>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-7 w-7 shrink-0 rounded-full opacity-70 hover:opacity-100"
        aria-label="移除附件"
        onClick={onRemove}
      >
        <IconX className="h-3.5 w-3.5" />
      </Button>
    </div>
  );
}
