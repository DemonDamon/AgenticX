import { useMemo, useState } from "react";
import type { MessageAttachment } from "../../store";
import { Modal } from "../ds/Modal";

function formatFileSize(size: number): string {
  if (size < 1024) return `${size}B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)}KB`;
  return `${(size / (1024 * 1024)).toFixed(1)}MB`;
}

function fileBadgeColor(name: string): string {
  const lower = name.toLowerCase();
  if (/\.(ts|tsx|js|jsx|py|go|java|rs|sh|json|yaml|yml|sql|md|toml|xml)$/.test(lower)) {
    return "var(--status-success)";
  }
  if (/\.(pdf|doc|docx|ppt|pptx|xls|xlsx|csv)$/.test(lower)) {
    return "var(--status-info)";
  }
  return "var(--text-faint)";
}

function fileKindLabel(att: MessageAttachment): string {
  const lower = att.name.toLowerCase();
  const mime = att.mimeType.toLowerCase();
  if (mime.includes("python") || lower.endsWith(".py")) return "代码";
  if (/\.(ts|tsx|js|jsx|mjs|cjs|go|rs|java|kt|swift|c|cpp|h|hpp|cs|rb|php)$/.test(lower)) return "代码";
  if (/\.(md|txt|log|yaml|yml|json|toml|xml|html|css|sql|sh)$/.test(lower)) return "文本";
  if (/\.(pdf|doc|docx|ppt|pptx|xls|xlsx)$/.test(lower)) return "文档";
  return "文件";
}

function isImage(att: MessageAttachment): boolean {
  return att.mimeType.startsWith("image/") && !!att.dataUrl;
}

export function AttachmentCard({ attachment }: { attachment: MessageAttachment }) {
  const [open, setOpen] = useState(false);
  const image = isImage(attachment);
  const ext = useMemo(() => {
    const idx = attachment.name.lastIndexOf(".");
    if (idx < 0 || idx === attachment.name.length - 1) return "FILE";
    return attachment.name.slice(idx + 1).toUpperCase();
  }, [attachment.name]);

  if (image) {
    return (
      <>
        <button
          className="group block overflow-hidden rounded-xl border border-border bg-surface-panel text-left"
          onClick={() => setOpen(true)}
          title="点击查看原图"
        >
          <img
            src={attachment.dataUrl}
            alt={attachment.name}
            className="max-h-[200px] w-auto max-w-[220px] object-cover transition group-hover:scale-[1.01]"
          />
          <div className="px-2 py-1 text-[11px] text-text-faint">
            {attachment.name} · {formatFileSize(attachment.size)}
          </div>
        </button>
        <Modal open={open} title={attachment.name} onClose={() => setOpen(false)}>
          <div className="flex max-h-[72vh] items-center justify-center overflow-auto">
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              className="h-auto max-h-[68vh] w-auto max-w-full rounded-lg"
            />
          </div>
        </Modal>
      </>
    );
  }

  return (
    <div className="flex min-w-[220px] max-w-[260px] items-center gap-2 rounded-xl border border-border bg-surface-panel px-2.5 py-2">
      <div
        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[10px] font-semibold"
        style={{ background: "var(--surface-hover)", color: fileBadgeColor(attachment.name) }}
      >
        {ext}
      </div>
      <div className="min-w-0">
        <div className="truncate text-xs text-text-muted">{attachment.name}</div>
        <div className="text-[10px] text-text-faint">
          {fileKindLabel(attachment)} · {formatFileSize(attachment.size)}
        </div>
      </div>
    </div>
  );
}
