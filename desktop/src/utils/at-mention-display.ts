import { fileNameFromPath, formatReferencePathHint } from "./chat-file-mention";

export type AtMentionCandidate =
  | {
      kind: "avatar";
      avatarId: string;
      label: string;
      role: string;
      avatarUrl?: string;
    }
  | {
      kind: "file";
      taskspaceId: string;
      path: string;
      label: string;
    }
  | {
      kind: "taskspace";
      taskspaceId: string;
      path: string;
      label: string;
      alias: string;
    }
  /** A directory nested inside a taskspace; `path` is relative to the taskspace root. */
  | {
      kind: "dir";
      taskspaceId: string;
      path: string;
      label: string;
    };

export type AtMentionIconTone = "folder" | "document" | "code" | "image" | "pdf" | "generic" | "avatar";

export function atMentionPrimaryText(item: AtMentionCandidate): string {
  if (item.kind === "file") {
    return String(item.label || fileNameFromPath(item.path) || item.path).trim();
  }
  return String(item.label || "").trim();
}

/** Short parent / location hint — never the raw absolute dump. */
export function atMentionSecondaryText(item: AtMentionCandidate): string {
  if (item.kind === "avatar") return String(item.role || "").trim();
  if (item.kind === "taskspace") return compactAtMentionPath(item.path);
  // `dir` and `file` both carry taskspace-relative paths: hint the parent only.
  return compactAtMentionPath(item.path, { parentOnly: true });
}

export function compactAtMentionPath(
  rawPath: string,
  options?: { parentOnly?: boolean }
): string {
  const norm = String(rawPath || "")
    .trim()
    .replace(/\\/g, "/");
  if (!norm || norm === ".") return "";
  const target = options?.parentOnly ? parentDir(norm) : norm;
  if (!target || target === ".") return "";
  if (target.startsWith("/")) {
    const hinted = formatReferencePathHint(options?.parentOnly ? `${target}/x` : target);
    return shortenHint(hinted || lastTwoSegments(target));
  }
  return shortenHint(lastTwoSegments(target));
}

export function atMentionIconTone(item: AtMentionCandidate): AtMentionIconTone {
  if (item.kind === "avatar") return "avatar";
  if (item.kind === "taskspace" || item.kind === "dir") return "folder";
  const name = atMentionPrimaryText(item).toLowerCase();
  if (/\.pdf$/.test(name)) return "pdf";
  if (/\.(png|jpe?g|gif|webp|bmp|svg|heic|avif|ico)$/.test(name)) return "image";
  if (/\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|c|cpp|h|hpp|cs|rb|php|sh|json|yaml|yml|toml|xml|html|css|sql)$/.test(name)) {
    return "code";
  }
  if (/\.(md|mdx|txt|doc|docx|ppt|pptx|rtf|odt)$/.test(name)) return "document";
  return "generic";
}

export function groupAtMentionCandidates(items: AtMentionCandidate[]): {
  avatars: AtMentionCandidate[];
  folders: AtMentionCandidate[];
  files: AtMentionCandidate[];
} {
  const avatars: AtMentionCandidate[] = [];
  const folders: AtMentionCandidate[] = [];
  const files: AtMentionCandidate[] = [];
  for (const item of items) {
    if (item.kind === "avatar") avatars.push(item);
    else if (item.kind === "taskspace" || item.kind === "dir") folders.push(item);
    else files.push(item);
  }
  return { avatars, folders, files };
}

/** One level up inside a taskspace; "." means the taskspace root. */
export function parentBrowsePath(relPath: string): string {
  const norm = String(relPath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+$/, "");
  if (!norm || norm === ".") return ".";
  const parent = parentDir(norm);
  return parent || ".";
}

/** Breadcrumb caption for the browse header, e.g. `AgenticX / desktop / src`. */
export function browseTrailLabel(taskspaceLabel: string, relPath: string): string {
  const root = String(taskspaceLabel || "").trim() || "workspace";
  const norm = String(relPath || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "");
  const parts = norm === "." ? [] : norm.split("/").filter(Boolean);
  const trail = parts.length > 3 ? ["…", ...parts.slice(-3)] : parts;
  return [root, ...trail].join(" / ");
}

function parentDir(norm: string): string {
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return "";
  return norm.slice(0, idx);
}

function lastTwoSegments(norm: string): string {
  const parts = norm.split("/").filter(Boolean);
  if (parts.length <= 2) return parts.join("/");
  return parts.slice(-2).join("/");
}

function shortenHint(hint: string): string {
  const text = String(hint || "").trim();
  if (text.length <= 36) return text;
  return `…${text.slice(-34)}`;
}
