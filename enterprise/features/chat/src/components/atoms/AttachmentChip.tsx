"use client";

import * as React from "react";
import { Button } from "@agenticx/ui";
import type { ComposerAttachment } from "../../types/composer-attachment";

function IconX({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </svg>
  );
}

type AttachmentChipProps = {
  file: ComposerAttachment;
  onRemove: () => void;
};

export function AttachmentChip({ file, onRemove }: AttachmentChipProps) {
  const isImage = !!file.dataUrl || file.mimeType.startsWith("image/");
  return (
    <div className="group relative inline-flex max-w-[240px] items-center gap-3 rounded-xl border border-border bg-background px-3 py-2 text-sm transition-colors hover:bg-muted/40">
      {isImage && file.dataUrl ? (
        <img src={file.dataUrl} alt={file.name} className="h-10 w-10 shrink-0 rounded-lg object-cover" />
      ) : (
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <span className="text-xs font-medium">IMG</span>
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium leading-tight">{file.name}</div>
        <div className="text-xs text-muted-foreground">
          {file.status === "parsing" ? "处理中…" : file.status === "error" ? file.errorText ?? "失败" : "已就绪"}
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
