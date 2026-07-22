import { useMemo, useState, type ReactNode } from "react";
import type { MessageAttachment } from "../../store";
import { Modal } from "../ds/Modal";
import { ZoomableImage } from "../ds/ZoomableImage";
import { formatReferencePathHint, resolveReferenceSourcePath } from "../../utils/chat-file-mention";
import { isWorkspaceReferenceAttachment } from "../../utils/reference-attachment";

type FileIconKind = "spreadsheet" | "document" | "code" | "image" | "generic";

function fileExt(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return "FILE";
  return name.slice(idx + 1).toUpperCase();
}

function resolveIconKind(name: string, mimeType: string): FileIconKind {
  const lower = name.toLowerCase();
  const mime = mimeType.toLowerCase();
  if (mime.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp|svg|heic|avif)$/.test(lower)) {
    return "image";
  }
  if (/\.(xls|xlsx|csv|tsv|ods)$/.test(lower) || mime.includes("spreadsheet") || mime === "text/csv") {
    return "spreadsheet";
  }
  if (/\.(pdf|doc|docx|ppt|pptx|pages|rtf|odt|txt|md)$/.test(lower)) {
    return "document";
  }
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|cpp|h|hpp|cs|rb|php|sh|json|yaml|yml|toml|xml|html|css|sql)$/.test(lower)) {
    return "code";
  }
  return "generic";
}

function iconPalette(kind: FileIconKind): { bg: string; fg: string } {
  switch (kind) {
    case "spreadsheet":
      return { bg: "rgba(34, 197, 94, 0.16)", fg: "rgb(22, 163, 74)" };
    case "document":
      return { bg: "rgba(59, 130, 246, 0.14)", fg: "rgb(37, 99, 235)" };
    case "code":
      return { bg: "rgba(168, 85, 247, 0.14)", fg: "rgb(147, 51, 234)" };
    case "image":
      return { bg: "rgba(236, 72, 153, 0.12)", fg: "rgb(219, 39, 119)" };
    default:
      return { bg: "var(--surface-hover)", fg: "var(--text-faint)" };
  }
}

function FileTypeGlyph({ kind }: { kind: FileIconKind }): ReactNode {
  const common = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    className: "h-[18px] w-[18px]",
  } as const;
  if (kind === "spreadsheet") {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 5.5A1.5 1.5 0 015.5 4h13A1.5 1.5 0 0120 5.5v13a1.5 1.5 0 01-1.5 1.5h-13A1.5 1.5 0 014 18.5v-13z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 9.5h16M4 14.5h16M9.5 4v16" />
      </svg>
    );
  }
  if (kind === "document") {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M7 3.5h6.5L19 9v11.5A1.5 1.5 0 0117.5 22h-10A1.5 1.5 0 016 20.5v-15A1.5 1.5 0 017.5 4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 3.5V9H19M9 13h6M9 17h4" />
      </svg>
    );
  }
  if (kind === "code") {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8 8l-4 4 4 4M16 8l4 4-4 4M13 5l-2 14" />
      </svg>
    );
  }
  if (kind === "image") {
    return (
      <svg {...common}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 5.5A1.5 1.5 0 016.5 4h11A1.5 1.5 0 0119 5.5v13a1.5 1.5 0 01-1.5 1.5h-11A1.5 1.5 0 015 18.5v-13z" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 15.5l4-4 3 3 2-2 5 5" />
        <circle cx="9" cy="9" r="1.4" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 3.5h5.5L18 8v12.5A1.5 1.5 0 0116.5 22h-8A1.5 1.5 0 017 20.5v-15A1.5 1.5 0 018.5 4" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 3.5V8H18" />
    </svg>
  );
}

function isImage(att: MessageAttachment): boolean {
  return att.mimeType.startsWith("image/") && !!att.dataUrl;
}

function AttachmentCardShell({
  title,
  ext,
  icon,
  onClick,
  interactive,
}: {
  title: string;
  ext: string;
  icon: ReactNode;
  onClick?: () => void;
  interactive?: boolean;
}) {
  const className =
    "group flex min-w-[148px] max-w-[200px] items-center gap-2.5 rounded-2xl border border-border/70 bg-surface-panel px-2.5 py-2 text-left shadow-[0_1px_0_rgba(0,0,0,0.03)] transition-colors hover:bg-surface-hover/80";
  const body = (
    <>
      <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-[10px]">
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium leading-tight text-text-strong">{title}</div>
        <div className="mt-0.5 truncate text-[11px] uppercase tracking-wide text-text-faint">{ext}</div>
      </div>
    </>
  );

  if (interactive && onClick) {
    return (
      <button type="button" className={className} onClick={onClick} title={title}>
        {body}
      </button>
    );
  }

  return (
    <div className={className} title={title}>
      {body}
    </div>
  );
}

/** Trae Work–style compact attachment chip (icon/thumbnail + name + EXT). */
export function AttachmentCard({ attachment }: { attachment: MessageAttachment }) {
  const [open, setOpen] = useState(false);
  const image = isImage(attachment);
  const isReference = isWorkspaceReferenceAttachment(attachment);
  const pathHint =
    isReference && attachment.sourcePath ? formatReferencePathHint(attachment.sourcePath) : "";
  const cardTitle = attachment.sourcePath
    ? resolveReferenceSourcePath(attachment.name, attachment.sourcePath)
    : attachment.name;
  const ext = useMemo(() => fileExt(attachment.name), [attachment.name]);
  const kind = useMemo(
    () => resolveIconKind(attachment.name, attachment.mimeType),
    [attachment.name, attachment.mimeType]
  );
  const palette = iconPalette(kind);
  const secondary = pathHint ? `@ ${pathHint}` : ext;

  if (image) {
    return (
      <>
        <AttachmentCardShell
          title={attachment.name}
          ext={ext}
          interactive
          onClick={() => setOpen(true)}
          icon={
            <img
              src={attachment.dataUrl}
              alt={attachment.name}
              className="h-full w-full object-cover transition group-hover:scale-[1.03]"
            />
          }
        />
        <Modal
          open={open}
          title={attachment.name}
          onClose={() => setOpen(false)}
          panelClassName="w-[90vw] max-w-4xl bg-surface-popover"
        >
          <ZoomableImage src={attachment.dataUrl!} alt={attachment.name} maxHeight="70vh" />
        </Modal>
      </>
    );
  }

  return (
    <AttachmentCardShell
      title={attachment.name}
      ext={secondary}
      icon={
        <div
          className="flex h-full w-full items-center justify-center"
          style={{ background: palette.bg, color: palette.fg }}
        >
          <FileTypeGlyph kind={kind} />
        </div>
      }
    />
  );
}
