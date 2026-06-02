import type { SVGProps } from "react";

export type ComposerRefIconKind = "folder" | "file";

type RefMeta = {
  composerRefLabel?: string;
  name?: string;
};

/** Shared chip layout: inline (not inline-flex) so baseline aligns with composer text like Cursor. */
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

/** Resolve icon kind: folder for @工作区/目录别名，其余一律通用文档图标。 */
export function resolveComposerRefIconKind(
  label: string,
  meta?: RefMeta | null
): ComposerRefIconKind {
  const trimmed = String(label || "").trim();
  if (!trimmed) return "file";

  if (trimmed.startsWith("@dir:")) return "folder";
  if (meta?.composerRefLabel && meta.composerRefLabel === trimmed) return "folder";
  if (meta?.name?.startsWith("@dir:") && meta.composerRefLabel === trimmed) return "folder";

  // 有扩展名 → 文件；无扩展名且无路径分隔 → 目录别名（如 AgenticX）
  if (extOf(trimmed)) return "file";
  if (!trimmed.includes("/") && !trimmed.includes("\\")) return "folder";

  return "file";
}

const ICON_CLASS = "agx-composer-inline-chip-icon h-[0.95em] w-[0.95em] shrink-0 opacity-90";

function FolderIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path
        d="M2 4.5A1.5 1.5 0 013.5 3H6l1.2 1.2H12.5A1.5 1.5 0 0114 5.7v5.8a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** 通用文档：竖向矩形 + 右上角折角，对齐 Cursor 简洁风格。 */
function FileIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden {...props}>
      <path
        d="M5 2.5h4.5l3 3v7.5a1 1 0 01-1 1H5a1 1 0 01-1-1V3.5a1 1 0 011-1z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M9.5 2.5v3h3"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

const FOLDER_INNER_HTML = `<path d="M2 4.5A1.5 1.5 0 013.5 3H6l1.2 1.2H12.5A1.5 1.5 0 0114 5.7v5.8a1.5 1.5 0 01-1.5 1.5h-9A1.5 1.5 0 012 11.5v-7z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>`;

const FILE_INNER_HTML = `<path d="M5 2.5h4.5l3 3v7.5a1 1 0 01-1 1H5a1 1 0 01-1-1V3.5a1 1 0 011-1z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/><path d="M9.5 2.5v3h3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`;

/** Inline SVG for contenteditable composer chips (non-React DOM). */
export function composerRefIconInnerHtml(kind: ComposerRefIconKind, sizePx = 13): string {
  const inner = kind === "folder" ? FOLDER_INNER_HTML : FILE_INNER_HTML;
  return `<svg viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" class="agx-composer-inline-chip-icon" style="width:${sizePx}px;height:${sizePx}px;display:inline;vertical-align:-0.12em;margin-right:0.22em;opacity:0.92">${inner}</svg>`;
}

export function ComposerRefIcon({
  kind,
  className,
}: {
  kind: ComposerRefIconKind;
  className?: string;
}) {
  const Icon = kind === "folder" ? FolderIcon : FileIcon;
  return <Icon className={className ?? ICON_CLASS} />;
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
