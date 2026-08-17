import type { SVGProps } from "react";

export type ComposerRefIconKind =
  | "folder"
  | "document"
  | "code"
  | "image"
  | "pdf"
  | "file"
  | "element";

type RefMeta = {
  composerRefLabel?: string;
  name?: string;
  htmlElementRef?: { tagName: string; selectorHint: string; comment?: string };
};

/** Shared chip layout: inline (not inline-flex) so baseline aligns with composer text. */
export const COMPOSER_INLINE_CHIP_CLASS =
  "agx-composer-inline-chip mx-[2px] inline max-w-[min(100%,280px)] align-baseline whitespace-nowrap rounded px-1 text-[0.95em] font-medium leading-[inherit]";

function basename(label: string): string {
  const norm = label.replace(/\\/g, "/");
  const idx = norm.lastIndexOf("/");
  return idx >= 0 ? norm.slice(idx + 1) : norm;
}

function extOf(label: string): string {
  const base = basename(label);
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot >= base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

const IMAGE_EXT = /^(png|jpe?g|gif|webp|bmp|svg|heic|avif|ico)$/;
const CODE_EXT =
  /^(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|cpp|h|hpp|cs|rb|php|sh|json|yaml|yml|toml|xml|html|css|sql)$/;
const DOC_EXT = /^(md|mdx|txt|doc|docx|ppt|pptx|rtf|odt)$/;

/** Resolve icon kind: folder / typed file / HTML select-element. */
export function resolveComposerRefIconKind(
  label: string,
  meta?: RefMeta | null
): ComposerRefIconKind {
  if (meta?.htmlElementRef?.tagName) return "element";

  const trimmed = String(label || "").trim();
  if (!trimmed) return "file";

  if (trimmed.startsWith("@dir:")) return "folder";
  if (meta?.name?.startsWith("@dir:") && meta.composerRefLabel === trimmed) return "folder";

  const ext = extOf(trimmed) || extOf(String(meta?.name || ""));
  if (ext === "pdf") return "pdf";
  if (IMAGE_EXT.test(ext)) return "image";
  if (CODE_EXT.test(ext)) return "code";
  if (DOC_EXT.test(ext)) return "document";
  if (ext) return "file";
  if (!trimmed.includes("/") && !trimmed.includes("\\")) return "folder";

  return "file";
}

const ICON_CLASS = "agx-composer-inline-chip-icon h-[0.95em] w-[0.95em] shrink-0";

function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path
        d="M1.8 4.4A1.7 1.7 0 013.5 2.8h2.15l.55.7c.18.22.45.35.74.35H12.5A1.7 1.7 0 0114.2 5.55v6.15A1.7 1.7 0 0112.5 13.4h-9A1.7 1.7 0 011.8 11.7V4.4z"
        fill="currentColor"
      />
      <path d="M1.8 6.55h12.4" stroke="#fff" strokeOpacity="0.22" strokeWidth="1" />
    </svg>
  );
}

function FileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path
        d="M4.1 1.9h5.05L12.2 5v8.15A1.15 1.15 0 0111.05 14.3H4.1A1.15 1.15 0 012.95 13.15V3.05A1.15 1.15 0 014.1 1.9z"
        fill="currentColor"
      />
      <path d="M9.15 1.9V5h3.05" fill="#fff" fillOpacity="0.28" />
    </svg>
  );
}

function DocumentIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" fill="currentColor" />
      <path
        d="M5.4 6.2h5.2M5.4 8h5.2M5.4 9.8h3.4"
        stroke="#fff"
        strokeWidth="1.15"
        strokeLinecap="round"
      />
    </svg>
  );
}

function CodeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" fill="currentColor" />
      <path
        d="M6.2 5.6L4.4 8l1.8 2.4M9.8 5.6L11.6 8l-1.8 2.4"
        stroke="#fff"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ImageIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" fill="currentColor" />
      <circle cx="6" cy="6.1" r="1.05" fill="#fff" />
      <path
        d="M3.6 11.6l2.6-2.5 1.7 1.6 2.1-2.2 2.4 3.1"
        stroke="#fff"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function PdfIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" fill="currentColor" />
      <path
        d="M5.2 10.6V5.5h2.05c1.15 0 1.85.62 1.85 1.55 0 .94-.72 1.58-1.9 1.58H6.35v2zM6.35 7.55h.75c.5 0 .82-.26.82-.66s-.32-.64-.82-.64h-.75v1.3z"
        fill="#fff"
      />
    </svg>
  );
}

function ElementIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path
        d="M3.5 2.5l8.5 5.2-3.6.9-1.7 3.8L3.5 2.5z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
      <circle cx="12.2" cy="3.2" r="0.9" fill="currentColor" />
      <circle cx="13.5" cy="5.2" r="0.7" fill="currentColor" opacity="0.75" />
    </svg>
  );
}

const ICONS: Record<ComposerRefIconKind, (props: SVGProps<SVGSVGElement>) => ReturnType<typeof FolderIcon>> = {
  folder: FolderIcon,
  document: DocumentIcon,
  code: CodeIcon,
  image: ImageIcon,
  pdf: PdfIcon,
  file: FileIcon,
  element: ElementIcon,
};

const FOLDER_INNER =
  '<path d="M1.8 4.4A1.7 1.7 0 013.5 2.8h2.15l.55.7c.18.22.45.35.74.35H12.5A1.7 1.7 0 0114.2 5.55v6.15A1.7 1.7 0 0112.5 13.4h-9A1.7 1.7 0 011.8 11.7V4.4z" fill="currentColor"/><path d="M1.8 6.55h12.4" stroke="#fff" stroke-opacity="0.22" stroke-width="1"/>';
const FILE_INNER =
  '<path d="M4.1 1.9h5.05L12.2 5v8.15A1.15 1.15 0 0111.05 14.3H4.1A1.15 1.15 0 012.95 13.15V3.05A1.15 1.15 0 014.1 1.9z" fill="currentColor"/><path d="M9.15 1.9V5h3.05" fill="#fff" fill-opacity="0.28"/>';
const DOCUMENT_INNER =
  '<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" fill="currentColor"/><path d="M5.4 6.2h5.2M5.4 8h5.2M5.4 9.8h3.4" stroke="#fff" stroke-width="1.15" stroke-linecap="round"/>';
const CODE_INNER =
  '<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" fill="currentColor"/><path d="M6.2 5.6L4.4 8l1.8 2.4M9.8 5.6L11.6 8l-1.8 2.4" stroke="#fff" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>';
const IMAGE_INNER =
  '<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" fill="currentColor"/><circle cx="6" cy="6.1" r="1.05" fill="#fff"/><path d="M3.6 11.6l2.6-2.5 1.7 1.6 2.1-2.2 2.4 3.1" stroke="#fff" stroke-width="1.15" stroke-linecap="round" stroke-linejoin="round"/>';
const PDF_INNER =
  '<rect x="2.2" y="2.2" width="11.6" height="11.6" rx="2.4" fill="currentColor"/><path d="M5.2 10.6V5.5h2.05c1.15 0 1.85.62 1.85 1.55 0 .94-.72 1.58-1.9 1.58H6.35v2zM6.35 7.55h.75c.5 0 .82-.26.82-.66s-.32-.64-.82-.64h-.75v1.3z" fill="#fff"/>';
const ELEMENT_INNER =
  '<path d="M3.5 2.5l8.5 5.2-3.6.9-1.7 3.8L3.5 2.5z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/><circle cx="12.2" cy="3.2" r="0.9" fill="currentColor"/><circle cx="13.5" cy="5.2" r="0.7" fill="currentColor" opacity="0.75"/>';

const KIND_INNER: Record<ComposerRefIconKind, string> = {
  folder: FOLDER_INNER,
  document: DOCUMENT_INNER,
  code: CODE_INNER,
  image: IMAGE_INNER,
  pdf: PDF_INNER,
  file: FILE_INNER,
  element: ELEMENT_INNER,
};

/** Inline SVG for contenteditable composer chips (non-React DOM). */
export function composerRefIconInnerHtml(kind: ComposerRefIconKind, sizePx = 13): string {
  return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="agx-composer-inline-chip-icon" data-tone="${kind}" style="width:${sizePx}px;height:${sizePx}px;display:inline;vertical-align:-0.12em;margin-right:0.22em">${KIND_INNER[kind]}</svg>`;
}

export function ComposerRefIcon({
  kind,
  className,
}: {
  kind: ComposerRefIconKind;
  className?: string;
}) {
  const Icon = ICONS[kind];
  return <Icon className={className ?? ICON_CLASS} data-tone={kind} />;
}

export function resolveComposerRefIconKindFromAttachments(
  label: string,
  attachments: RefMeta[]
): ComposerRefIconKind {
  const meta = attachments.find(
    (att) => att.composerRefLabel === label || att.name === label || basename(att.name || "") === label
  );
  return resolveComposerRefIconKind(label, meta);
}
