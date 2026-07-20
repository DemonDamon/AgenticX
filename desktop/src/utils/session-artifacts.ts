/**
 * Collect on-disk artifact paths produced in the current chat session.
 *
 * Sources (aligned with team_manager output-file extraction):
 * - file_write / file_edit tool rows (toolArgs.path + OK: wrote|edited)
 * - bash_exec redirect / tee targets in toolArgs.command
 * - bash_exec stdout JSON `"output": "/abs/file.ext"` (e.g. openpyxl wb.save)
 * - labeled save paths in assistant prose (保存路径 / 路径 / 已保存至 …)
 * - save labels with the absolute file path on a following line
 * - sub-agent outputFiles / resultFile
 *
 * Author: Damon Li
 */

import type { Message, SubAgent } from "../store";
import { isAbsoluteFilePath } from "./workspace-file-path";

const OK_WRITE_RE = /OK:\s*(?:wrote|edited)\s+(.+?)(?:\s+\(\d+\s+chars\))?/gi;

const ABS_PATH_BODY =
  "(\\/(?:Users|home|tmp|var|opt|private|Volumes)[^\\s`<>\\[\\]()]+|[a-zA-Z]:[\\\\/][^\\s`<>\\[\\]()]+|~\\/[^\\s`<>\\[\\]()]+)";

const SAVED_FILE_LABEL =
  "(?:报告已保存(?:至|到)|文件已保存(?:至|到)|报告(?:文件)?已落盘(?:至|到)?|已保存(?:至|到)|保存路径|路径|saved\\s+to|written\\s+to|report\\s+saved\\s+to|file\\s+saved\\s+to)";

const LABELED_SAVE_PATH_RE = new RegExp(
  `${SAVED_FILE_LABEL}[：:\\s]*(\`?)${ABS_PATH_BODY}(\\1)`,
  "gi",
);

/** Line that introduces a saved artifact; path may follow on later lines. */
const SAVE_CUE_LINE_RE =
  /(?:保存路径|路径|已保存(?:至|到)?|saved\s+to|written\s+to|report\s+saved\s+to|file\s+saved\s+to)/i;

const INLINE_ABS_PATH_RE = new RegExp(`\`?${ABS_PATH_BODY}\`?`, "g");

/** bash / skill JSON result: "output": "/abs/file.ext" */
const JSON_OUTPUT_PATH_RE =
  /"output"\s*:\s*"(\/(?:Users|home|tmp|var|opt|private|Volumes)[^"\s]+|[a-zA-Z]:[\\/][^"\s]+|~\/[^"\s]+)"/gi;

const BASH_REDIRECT_RE = /(?:>>?|\btee\b(?:\s+-a)?)\s+(['"]?)([^\s'"|;&<>]+)\1/g;

/** Markdown table cell that looks like a bare filename with extension. */
const TABLE_FILENAME_RE = /^\|\s*`?([^`|/\\]+\.[a-zA-Z0-9]{1,12})`?\s*\|/gm;

function looksLikeArtifactFile(path: string): boolean {
  const base = path.split("/").pop() || "";
  return Boolean(base && /\.[a-zA-Z0-9]{1,12}$/.test(base));
}

function normalizeArtifactPath(raw: string): string | null {
  let value = String(raw || "").trim();
  if (!value) return null;
  if (
    (value.startsWith("`") && value.endsWith("`")) ||
    (value.startsWith("'") && value.endsWith("'")) ||
    (value.startsWith('"') && value.endsWith('"'))
  ) {
    value = value.slice(1, -1).trim();
  }
  value = value.replace(/[，。；：！？,.]+$/u, "").trim();
  if (!value || /\s/.test(value)) return null;
  if (!isAbsoluteFilePath(value) && !value.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(value) && !value.startsWith("~/")) {
    return null;
  }
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || null;
}

function addPath(paths: string[], seen: Set<string>, raw: string): void {
  const normalized = normalizeArtifactPath(raw);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  paths.push(normalized);
}

function extractOkWritePaths(content: string, paths: string[], seen: Set<string>): void {
  OK_WRITE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = OK_WRITE_RE.exec(content)) !== null) {
    addPath(paths, seen, match[1] ?? "");
  }
}

function extractLabeledSavePaths(content: string, paths: string[], seen: Set<string>): void {
  LABELED_SAVE_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LABELED_SAVE_PATH_RE.exec(content)) !== null) {
    const candidate = normalizeArtifactPath(match[2] ?? "");
    if (!candidate) continue;
    // Directory-only labels are join bases for table filenames, not standalone artifacts.
    if (!looksLikeArtifactFile(candidate)) continue;
    addPath(paths, seen, candidate);
  }
}

/**
 * Common agent report shape:
 *   ## 1. 新 Excel 已保存
 *   路径：
 *   `/Users/.../file.xlsx`
 */
function extractNearbyLabeledSavePaths(content: string, paths: string[], seen: Set<string>): void {
  const lines = String(content || "").split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const cueLine = lines[i] ?? "";
    if (!SAVE_CUE_LINE_RE.test(cueLine)) continue;

    let nonEmptySeen = 0;
    for (let j = i; j < lines.length && nonEmptySeen < 6; j++) {
      const line = (lines[j] ?? "").trim();
      if (!line) continue;
      if (j > i) nonEmptySeen += 1;

      INLINE_ABS_PATH_RE.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = INLINE_ABS_PATH_RE.exec(line)) !== null) {
        const candidate = normalizeArtifactPath(match[1] ?? "");
        if (!candidate || !looksLikeArtifactFile(candidate)) continue;
        addPath(paths, seen, candidate);
      }
    }
  }
}

function extractBashRedirectPaths(command: string, paths: string[], seen: Set<string>): void {
  BASH_REDIRECT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = BASH_REDIRECT_RE.exec(command)) !== null) {
    const raw = String(match[2] || "").trim();
    if (!raw || raw.startsWith("/dev/")) continue;
    // Only keep absolute / home-relative targets; relative redirects need a cwd we may not have.
    if (raw.startsWith("/") || raw.startsWith("~/") || /^[a-zA-Z]:[\\/]/.test(raw)) {
      addPath(paths, seen, raw);
    }
  }
}

/** Pull artifact file paths from bash/skill JSON stdout (`"output": "/abs/file.ext"`). */
function extractJsonOutputArtifactPaths(content: string, paths: string[], seen: Set<string>): void {
  JSON_OUTPUT_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = JSON_OUTPUT_PATH_RE.exec(content)) !== null) {
    const candidate = normalizeArtifactPath(match[1] ?? "");
    if (!candidate || !looksLikeArtifactFile(candidate)) continue;
    addPath(paths, seen, candidate);
  }
}

/** Join table filenames with a same-message「保存路径」directory (common agent report pattern). */
function extractTableFilesUnderSaveDirs(content: string, paths: string[], seen: Set<string>): void {
  const dirs: string[] = [];
  const dirSeen = new Set<string>();
  LABELED_SAVE_PATH_RE.lastIndex = 0;
  let labelMatch: RegExpExecArray | null;
  while ((labelMatch = LABELED_SAVE_PATH_RE.exec(content)) !== null) {
    const dir = normalizeArtifactPath(labelMatch[2] ?? "");
    if (!dir || dirSeen.has(dir)) continue;
    // Prefer directory-like labels; skip if it already looks like a concrete file.
    if (/\.[a-zA-Z0-9]{1,12}$/.test(dir.split("/").pop() || "")) continue;
    dirSeen.add(dir);
    dirs.push(dir);
  }
  if (dirs.length === 0) return;

  TABLE_FILENAME_RE.lastIndex = 0;
  let fileMatch: RegExpExecArray | null;
  while ((fileMatch = TABLE_FILENAME_RE.exec(content)) !== null) {
    const name = String(fileMatch[1] || "").trim();
    if (!name || name.includes("..")) continue;
    for (const dir of dirs) {
      addPath(paths, seen, `${dir.replace(/\/+$/, "")}/${name}`);
    }
  }
}

/** Extract artifact absolute paths from pane messages + sub-agent outputs. */
export function collectSessionArtifactPaths(
  messages: Message[] | undefined | null,
  subAgents?: SubAgent[] | undefined | null,
  extraPaths?: string[] | undefined | null,
  ownerSessionId?: string | null,
): string[] {
  const paths: string[] = [];
  const seen = new Set<string>();
  const sid = String(ownerSessionId || "").trim();

  for (const message of messages ?? []) {
    if (sid && message.ownerSessionId && message.ownerSessionId !== sid) continue;
    const role = message.role;

    if (role === "tool") {
      const toolName = String(message.toolName || "").trim();
      if (toolName === "file_write" || toolName === "file_edit") {
        const argPath = String(message.toolArgs?.path ?? "").trim();
        if (argPath) addPath(paths, seen, argPath);
        extractOkWritePaths(String(message.content || ""), paths, seen);
        extractOkWritePaths(String(message.toolResultPreview || ""), paths, seen);
      } else if (toolName === "bash_exec") {
        const command = String(message.toolArgs?.command ?? "").trim();
        if (command) extractBashRedirectPaths(command, paths, seen);
        extractJsonOutputArtifactPaths(String(message.content || ""), paths, seen);
        extractJsonOutputArtifactPaths(String(message.toolResultPreview || ""), paths, seen);
      } else {
        // Formatted tool rows may still embed OK: wrote even if toolName was lost.
        extractOkWritePaths(String(message.content || ""), paths, seen);
        extractJsonOutputArtifactPaths(String(message.content || ""), paths, seen);
        extractJsonOutputArtifactPaths(String(message.toolResultPreview || ""), paths, seen);
      }
      continue;
    }

    if (role === "assistant") {
      const body = String(message.content || "");
      extractLabeledSavePaths(body, paths, seen);
      extractNearbyLabeledSavePaths(body, paths, seen);
      extractOkWritePaths(body, paths, seen);
      extractTableFilesUnderSaveDirs(body, paths, seen);
    }
  }

  for (const agent of subAgents ?? []) {
    if (agent.resultFile) addPath(paths, seen, agent.resultFile);
    for (const file of agent.outputFiles ?? []) addPath(paths, seen, file);
  }

  for (const extra of extraPaths ?? []) addPath(paths, seen, extra);

  return paths;
}

export function artifactBaseName(path: string): string {
  const normalized = String(path || "").replace(/\\/g, "/");
  const trimmed = normalized.replace(/\/+$/, "");
  const idx = trimmed.lastIndexOf("/");
  return idx >= 0 ? trimmed.slice(idx + 1) || trimmed : trimmed;
}

/** True when path looks like a directory (trailing slash or no file extension segment). */
export function looksLikeDirectoryPath(path: string): boolean {
  const value = String(path || "").trim().replace(/\\/g, "/");
  if (!value) return false;
  if (value.endsWith("/")) return true;
  const base = artifactBaseName(value);
  if (!base || base === "." || base === "..") return true;
  // Has a short extension → likely a file; otherwise treat as directory candidate.
  return !/\.[a-zA-Z0-9]{1,12}$/.test(base);
}

/** HTML reports preview inside WorkPanel browser tab (Trae-style), not system Chrome. */
export function isInAppHtmlPreviewPath(path: string): boolean {
  const lower = String(path || "").trim().toLowerCase().replace(/\\/g, "/");
  const base = lower.split("/").pop() || lower;
  return base.endsWith(".html") || base.endsWith(".htm");
}

/**
 * Files that should open with Near in-app preview (WorkspaceFilePreview), not the OS
 * default app. HTML is handled separately via the WorkPanel browser tab.
 */
export function isInAppArtifactPreviewPath(path: string): boolean {
  if (!path || looksLikeDirectoryPath(path)) return false;
  if (isInAppHtmlPreviewPath(path)) return false;
  const base = artifactBaseName(path).toLowerCase();
  // Concrete file with a short extension → attempt WorkspaceFilePreview (PDF/Office/image/text…).
  return /\.[a-z0-9]{1,12}$/.test(base);
}

/** Convert an absolute filesystem path to a file:// URL for the browser address bar. */
export function pathToFileUrl(absPath: string): string {
  const normalized = String(absPath || "").trim().replace(/\\/g, "/");
  if (!normalized) return "about:blank";
  if (normalized.startsWith("file://")) return normalized;
  // encodeURI keeps path separators; encode # which would otherwise truncate the URL.
  const encoded = encodeURI(normalized).replace(/#/g, "%23");
  if (/^[a-zA-Z]:\//.test(normalized)) return `file:///${encoded}`;
  if (normalized.startsWith("/")) return `file://${encoded}`;
  return `file://${encoded}`;
}
