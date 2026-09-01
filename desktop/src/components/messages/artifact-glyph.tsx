/**
 * File-type marks for deliverable cards.
 * These are original stroke glyphs (not a third-party font). The Markdown
 * mark follows the public M↓ lockup so a .md card reads as markdown at a
 * glance, the way workbook-style file chips do.
 *
 * Author: Damon Li
 */

import type { ReactNode } from "react";
import { artifactExt } from "../../utils/session-artifacts";

export type FileMarkKind =
  | "md"
  | "txt"
  | "pdf"
  | "doc"
  | "sheet"
  | "slide"
  | "code"
  | "data"
  | "web"
  | "image"
  | "media"
  | "archive"
  | "generic";

export type ArtifactGlyph = {
  kind: FileMarkKind;
  /** Well + stroke follow the user accent (`--theme-color-rgb`), not light/dark. */
  tint: string;
  fg: string;
};

const ACCENT = {
  tint: "rgba(var(--theme-color-rgb, 59, 130, 246), 0.22)",
  fg: "rgb(var(--theme-color-rgb, 59, 130, 246))",
};

const BY_EXT: Record<string, FileMarkKind> = {
  md: "md",
  markdown: "md",
  txt: "txt",
  rtf: "txt",

  html: "web",
  htm: "web",

  pdf: "pdf",
  doc: "doc",
  docx: "doc",

  xls: "sheet",
  xlsx: "sheet",
  csv: "sheet",
  tsv: "sheet",

  ppt: "slide",
  pptx: "slide",

  json: "data",
  yaml: "data",
  yml: "data",
  toml: "data",
  ini: "data",

  zip: "archive",
  gz: "archive",
  tar: "archive",

  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  svg: "image",
  bmp: "image",

  mp3: "media",
  wav: "media",
  m4a: "media",
  mp4: "media",
  mov: "media",
  webm: "media",
};

const CODE_EXT = new Set([
  "ts", "tsx", "js", "jsx", "mjs", "cjs", "py", "go", "rs", "java", "kt",
  "swift", "c", "cpp", "h", "hpp", "cs", "rb", "php", "sh", "bash", "zsh",
  "sql", "css", "scss", "xml", "gd", "tscn", "godot", "vue", "svelte",
]);

export function artifactGlyph(path: string): ArtifactGlyph {
  const ext = artifactExt(path);
  const kind = BY_EXT[ext] ?? (CODE_EXT.has(ext) ? "code" : "generic");
  return { kind, ...ACCENT };
}

function MarkSvg({ kind, children }: { kind: FileMarkKind; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-[18px] w-[18px]"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      data-file-mark={kind}
    >
      {children}
    </svg>
  );
}

/** Distinctive lockup per file family — md is the public M↓ mark. */
export function FileTypeMark({ kind }: { kind: FileMarkKind }) {
  switch (kind) {
    case "md":
      return (
        <MarkSvg kind="md">
          <rect x="3" y="6" width="18" height="12" rx="1.6" />
          <path d="M6.4 15.2V8.8L9.2 12.4 12 8.8v6.4" />
          <path d="M14.6 12.2 17 15.2 19.4 12.2" />
          <path d="M17 15.2V8.8" />
        </MarkSvg>
      );
    case "txt":
      return (
        <MarkSvg kind="txt">
          <path d="M6 8h12M6 12h12M6 16h8" />
        </MarkSvg>
      );
    case "pdf":
      return (
        <MarkSvg kind="pdf">
          <path d="M7 3.8h7.2L18.6 8v12.2H7z" />
          <path d="M14.2 3.8V8h4.4" />
          <path d="M9.2 13.4h3.1a1.6 1.6 0 0 1 0 3.2H9.2V11.2h2.7a1.4 1.4 0 0 1 0 2.2" />
        </MarkSvg>
      );
    case "doc":
      return (
        <MarkSvg kind="doc">
          <path d="M7 3.8h7.2L18.6 8v12.2H7z" />
          <path d="M14.2 3.8V8h4.4M9.4 12.4h6.2M9.4 15.6h4.6" />
        </MarkSvg>
      );
    case "sheet":
      return (
        <MarkSvg kind="sheet">
          <rect x="4.4" y="5" width="15.2" height="14" rx="1.4" />
          <path d="M4.4 10h15.2M4.4 14.4h15.2M9.6 5v14M14.4 5v14" />
        </MarkSvg>
      );
    case "slide":
      return (
        <MarkSvg kind="slide">
          <rect x="3.4" y="5.4" width="17.2" height="11.4" rx="1.6" />
          <path d="M8 20.2h8M12 16.8v3.4" />
        </MarkSvg>
      );
    case "code":
      return (
        <MarkSvg kind="code">
          <path d="M8.4 8.2 4.8 12l3.6 3.8M15.6 8.2 19.2 12l-3.6 3.8M13.2 6.8 10.8 17.2" />
        </MarkSvg>
      );
    case "data":
      return (
        <MarkSvg kind="data">
          <path d="M9.2 7.2c-1.6 0-2.4.8-2.4 2.2v1.2c0 .8-.6 1.4-1.6 1.4 1 0 1.6.6 1.6 1.4v1.2c0 1.4.8 2.2 2.4 2.2" />
          <path d="M14.8 7.2c1.6 0 2.4.8 2.4 2.2v1.2c0 .8.6 1.4 1.6 1.4-1 0-1.6.6-1.6 1.4v1.2c0 1.4-.8 2.2-2.4 2.2" />
        </MarkSvg>
      );
    case "web":
      return (
        <MarkSvg kind="web">
          <circle cx="12" cy="12" r="8" />
          <path d="M4.4 12h15.2M12 4.2c2.4 2.4 3.6 5 3.6 7.8s-1.2 5.4-3.6 7.8c-2.4-2.4-3.6-5-3.6-7.8s1.2-5.4 3.6-7.8z" />
        </MarkSvg>
      );
    case "image":
      return (
        <MarkSvg kind="image">
          <rect x="4" y="5.2" width="16" height="13.6" rx="1.6" />
          <circle cx="9" cy="10" r="1.4" />
          <path d="M5.2 16.2 9.6 12l3.2 2.6 2.4-2.2 3.6 3.8" />
        </MarkSvg>
      );
    case "media":
      return (
        <MarkSvg kind="media">
          <rect x="3.6" y="6" width="16.8" height="12" rx="2" />
          <path d="M10.2 9.2v5.6L15.2 12z" />
        </MarkSvg>
      );
    case "archive":
      return (
        <MarkSvg kind="archive">
          <path d="M5 8.2h14v11.2H5zM5 8.2 7.4 4.8h9.2L19 8.2" />
          <path d="M12 8.2v7.2M10.6 12.4h2.8" />
        </MarkSvg>
      );
    default:
      return (
        <MarkSvg kind="generic">
          <path d="M7 3.8h7.2L18.6 8v12.2H7z" />
          <path d="M14.2 3.8V8h4.4" />
        </MarkSvg>
      );
  }
}
