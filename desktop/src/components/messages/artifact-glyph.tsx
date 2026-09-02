/**
 * File-type marks for deliverable cards and the workbench change list.
 * Compact original filled SVGs (16px) — no webfont / no remote icon pack,
 * so list refresh stays cheap. TXT follows a periwinkle folded sheet;
 * generic source files use a silver folded sheet; known languages get
 * distinct color lockups.
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
  | "py"
  | "go"
  | "c"
  | "cpp"
  | "js"
  | "ts"
  | "rs"
  | "java"
  | "css"
  | "data"
  | "web"
  | "image"
  | "media"
  | "archive"
  | "generic";

export type ArtifactGlyph = {
  kind: FileMarkKind;
  tint: string;
  fg: string;
};

const BY_EXT: Record<string, FileMarkKind> = {
  md: "md",
  markdown: "md",
  txt: "txt",
  rtf: "txt",

  py: "py",
  pyw: "py",
  go: "go",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  js: "js",
  mjs: "js",
  cjs: "js",
  jsx: "js",
  ts: "ts",
  tsx: "ts",
  rs: "rs",
  java: "java",
  kt: "java",
  css: "css",
  scss: "css",

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
  "swift", "cs", "rb", "php", "sh", "bash", "zsh",
  "sql", "xml", "gd", "tscn", "godot", "vue", "svelte",
]);

const KIND_SWATCH: Record<FileMarkKind, { tint: string; fg: string }> = {
  txt: { tint: "#6F8CFF", fg: "#FFFFFF" },
  code: { tint: "#C9CED8", fg: "#5C6570" },
  generic: { tint: "#C9CED8", fg: "#5C6570" },
  md: { tint: "#C9843A", fg: "#FFFFFF" },
  py: { tint: "#3776AB", fg: "#FFD43B" },
  go: { tint: "#00ADD8", fg: "#FFFFFF" },
  c: { tint: "#5C8DBC", fg: "#FFFFFF" },
  cpp: { tint: "#00599C", fg: "#FFFFFF" },
  js: { tint: "#F7DF1E", fg: "#323330" },
  ts: { tint: "#3178C6", fg: "#FFFFFF" },
  rs: { tint: "#DEA584", fg: "#1C1917" },
  java: { tint: "#E76F00", fg: "#FFFFFF" },
  css: { tint: "#264DE4", fg: "#FFFFFF" },
  web: { tint: "#E34F26", fg: "#FFFFFF" },
  pdf: { tint: "#E11D48", fg: "#FFFFFF" },
  doc: { tint: "#2B579A", fg: "#FFFFFF" },
  sheet: { tint: "#217346", fg: "#FFFFFF" },
  slide: { tint: "#C43E1C", fg: "#FFFFFF" },
  data: { tint: "#CA8A04", fg: "#FFFFFF" },
  image: { tint: "#7C3AED", fg: "#FFFFFF" },
  media: { tint: "#DB2777", fg: "#FFFFFF" },
  archive: { tint: "#78716C", fg: "#FFFFFF" },
};

export function artifactGlyph(path: string): ArtifactGlyph {
  const ext = artifactExt(path);
  const kind = BY_EXT[ext] ?? (CODE_EXT.has(ext) ? "code" : "generic");
  return { kind, ...KIND_SWATCH[kind] };
}

function Mark({ kind, children }: { kind: FileMarkKind; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 16 16"
      width={16}
      height={16}
      className="h-4 w-4"
      fill="none"
      aria-hidden
      data-file-mark={kind}
    >
      {children}
    </svg>
  );
}

/** Folded sheet used by TXT (periwinkle) and generic source (silver). */
function FoldedDoc({ fill, fold }: { fill: string; fold: string }) {
  return (
    <>
      <path
        fill={fill}
        d="M3.15 1.55h7.15L12.95 4.2v10c0 .7-.55 1.25-1.25 1.25H3.15c-.7 0-1.25-.55-1.25-1.25V2.8c0-.7.55-1.25 1.25-1.25Z"
      />
      <path fill={fold} d="M10.3 1.55v2.65h2.65Z" />
    </>
  );
}

function LetterBadge({
  kind,
  bg,
  fg,
  label,
}: {
  kind: FileMarkKind;
  bg: string;
  fg: string;
  label: string;
}) {
  const size = label.length === 1 ? 8 : label.length === 2 ? 6.6 : 5.2;
  return (
    <Mark kind={kind}>
      <rect width="16" height="16" rx="3.2" fill={bg} />
      <text
        x="8"
        y="11.15"
        textAnchor="middle"
        fill={fg}
        fontSize={size}
        fontWeight="700"
        fontFamily="ui-sans-serif,system-ui,sans-serif"
      >
        {label}
      </text>
    </Mark>
  );
}

/** Distinctive lockup per file family. */
export function FileTypeMark({ kind }: { kind: FileMarkKind }) {
  switch (kind) {
    case "txt":
      return (
        <Mark kind="txt">
          <FoldedDoc fill="#6F8CFF" fold="#5470E6" />
          <path fill="#fff" d="M4.15 7.55h6.55l-.7 1.55H3.45Z" />
          <path fill="#fff" d="M4.15 10.35h4.85l-.7 1.55H3.45Z" />
        </Mark>
      );
    case "code":
      return (
        <Mark kind="code">
          <FoldedDoc fill="#C9CED8" fold="#9AA3B2" />
        </Mark>
      );
    case "md":
      return (
        <Mark kind="md">
          <rect x="0.6" y="2.4" width="14.8" height="11.2" rx="2" fill="#C9843A" />
          <path
            fill="#fff"
            d="M3.3 11.2V4.9L5.7 8.05 8.1 4.9v6.3H3.3Zm6.5-2.4 1.85 2.4 1.85-2.4h.05V11.2h1.15V4.9h-1.15v3.5L11.7 6.3 9.8 8.4V4.9H8.65v6.3H9.8V8.8Z"
          />
        </Mark>
      );
    case "py":
      return (
        <Mark kind="py">
          <rect width="16" height="16" rx="3.2" fill="#2B5B84" />
          <path
            fill="#3776AB"
            d="M6.15 3.2h3.55c1.15 0 1.7.55 1.7 1.7v2.15H8.2c-1.25 0-2.1.65-2.1 1.9 0 .35.1.65.28.9H4.7c-.85 0-1.35-.55-1.35-1.4V6.55c0-1.9 1.15-3.35 2.8-3.35Z"
          />
          <circle cx="9.55" cy="5.05" r=".7" fill="#FFD43B" />
          <path
            fill="#FFD43B"
            d="M9.85 12.8H6.3c-1.15 0-1.7-.55-1.7-1.7V8.95h3.2c1.25 0 2.1-.65 2.1-1.9 0-.35-.1-.65-.28-.9h1.58c.85 0 1.35.55 1.35 1.4v2.05c0 1.9-1.15 3.35-2.8 3.35Z"
          />
          <circle cx="6.45" cy="10.95" r=".7" fill="#3776AB" />
        </Mark>
      );
    case "go":
      return <LetterBadge kind="go" bg="#00ADD8" fg="#fff" label="Go" />;
    case "c":
      return <LetterBadge kind="c" bg="#5C8DBC" fg="#fff" label="C" />;
    case "cpp":
      return <LetterBadge kind="cpp" bg="#00599C" fg="#fff" label="C++" />;
    case "js":
      return <LetterBadge kind="js" bg="#F7DF1E" fg="#323330" label="JS" />;
    case "ts":
      return <LetterBadge kind="ts" bg="#3178C6" fg="#fff" label="TS" />;
    case "rs":
      return <LetterBadge kind="rs" bg="#DEA584" fg="#1C1917" label="Rs" />;
    case "java":
      return <LetterBadge kind="java" bg="#E76F00" fg="#fff" label="Jv" />;
    case "css":
      return <LetterBadge kind="css" bg="#264DE4" fg="#fff" label="CSS" />;
    case "pdf":
      return <LetterBadge kind="pdf" bg="#E11D48" fg="#fff" label="PDF" />;
    case "doc":
      return (
        <Mark kind="doc">
          <FoldedDoc fill="#2B579A" fold="#1E3F73" />
          <path fill="#fff" d="M4.2 8.1h6.4v1.15H4.2Zm0 2.35h4.7v1.15H4.2Z" />
        </Mark>
      );
    case "sheet":
      return (
        <Mark kind="sheet">
          <rect x="1.4" y="2.2" width="13.2" height="11.6" rx="1.6" fill="#217346" />
          <path stroke="#fff" strokeWidth="1" d="M1.4 6.2h13.2M1.4 10h13.2M6.2 2.2v11.6M9.8 2.2v11.6" />
        </Mark>
      );
    case "slide":
      return (
        <Mark kind="slide">
          <rect x="1.2" y="3.1" width="13.6" height="8.4" rx="1.5" fill="#C43E1C" />
          <path stroke="#fff" strokeWidth="1.2" strokeLinecap="round" d="M6.2 13.6h3.6M8 11.5v2.1" />
        </Mark>
      );
    case "data":
      return <LetterBadge kind="data" bg="#CA8A04" fg="#fff" label="{}" />;
    case "web":
      return <LetterBadge kind="web" bg="#E34F26" fg="#fff" label="HTML" />;
    case "image":
      return (
        <Mark kind="image">
          <rect x="1.4" y="2.6" width="13.2" height="10.8" rx="1.6" fill="#7C3AED" />
          <circle cx="5.4" cy="6.2" r="1.15" fill="#FDE68A" />
          <path fill="#fff" d="M2.3 11.8 5.7 8.4l2.5 2.1 1.9-1.7 3.2 3Z" />
        </Mark>
      );
    case "media":
      return (
        <Mark kind="media">
          <rect x="1.2" y="3.2" width="13.6" height="9.6" rx="2" fill="#DB2777" />
          <path fill="#fff" d="M6.5 5.7v4.6L10.6 8Z" />
        </Mark>
      );
    case "archive":
      return (
        <Mark kind="archive">
          <path fill="#78716C" d="M2.4 5.4h11.2v8.4H2.4Z" />
          <path fill="#A8A29E" d="M2.4 5.4 4.2 2.8h7.6L13.6 5.4" />
          <path stroke="#fff" strokeWidth="1.1" strokeLinecap="round" d="M8 5.4v5.4M6.9 8.6h2.2" />
        </Mark>
      );
    default:
      return (
        <Mark kind="generic">
          <FoldedDoc fill="#C9CED8" fold="#9AA3B2" />
        </Mark>
      );
  }
}
