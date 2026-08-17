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

/**
 * Line that introduces a saved artifact; path may follow on later lines.
 * Bare「路径」must be a label (`路径：`), not prose like「管理 ~/.codewiki/… 路径」.
 */
const SAVE_CUE_LINE_RE =
  /(?:保存路径|路径\s*[：:]|已保存(?:至|到)?|saved\s+to|written\s+to|report\s+saved\s+to|file\s+saved\s+to)/i;

const INLINE_ABS_PATH_RE = new RegExp(`\`?${ABS_PATH_BODY}\`?`, "g");

/** bash / skill JSON result: "output": "/abs/file.ext" */
const JSON_OUTPUT_PATH_RE =
  /"output"\s*:\s*"(\/(?:Users|home|tmp|var|opt|private|Volumes)[^"\s]+|[a-zA-Z]:[\\/][^"\s]+|~\/[^"\s]+)"/gi;

const BASH_REDIRECT_RE = /(?:>>?|\btee\b(?:\s+-a)?)\s+(['"]?)([^\s'"|;&<>]+)\1/g;

/** Markdown table cell that looks like a bare filename with extension (any column). */
const TABLE_FILENAME_RE =
  /\|[ \t]*`?([^`|/\s\\]+\.[a-zA-Z0-9]{1,12})`?[ \t]*(?=\|)/g;

/** Skill/source trees listed by find/ls must not become task artifacts. */
const ARTIFACT_SOURCE_EXCLUDE_RE =
  /\/(?:\.agenticx\/skills|\.git|node_modules|site-packages)\//i;

const PREVIEW_IMAGE_RANK: Record<string, number> = {
  gif: 0,
  webp: 1,
  png: 2,
  jpg: 3,
  jpeg: 3,
  bmp: 4,
  svg: 5,
};

function looksLikeArtifactFile(path: string): boolean {
  const base = path.split("/").pop() || "";
  if (!base) return false;
  // Hidden config dirs (`.codewiki`, `.git`) look like "name.ext" to a naive regex — reject.
  if (/^\.[A-Za-z0-9_-]+$/.test(base)) return false;
  return /\.[a-zA-Z0-9]{1,12}$/.test(base);
}

/** Best-effort $HOME for expanding `~/…` during normalize (Node/Electron/Vitest). */
function homeDirForArtifacts(): string {
  try {
    const env = typeof process !== "undefined" ? process.env : undefined;
    const fromEnv = String(env?.HOME || env?.USERPROFILE || "").trim();
    if (fromEnv) return fromEnv.replace(/\\/g, "/").replace(/\/+$/, "");
  } catch {
    /* ignore */
  }
  return "";
}

/** Expand `~/…` when home is known; otherwise return the path unchanged. */
export function expandArtifactHomePath(value: string, homeDir?: string): string {
  const raw = String(value || "").trim().replace(/\\/g, "/");
  if (!raw) return "";
  const home = String(homeDir || homeDirForArtifacts() || "")
    .trim()
    .replace(/\\/g, "/")
    .replace(/\/+$/, "");
  if (!home) return raw;
  if (raw === "~") return home;
  if (raw.startsWith("~/")) return `${home}/${raw.slice(2)}`;
  return raw;
}

/**
 * Home-relative key so `~/Desktop/a.md` and `/Users/<name>/Desktop/a.md`
 * collide for dedupe even when $HOME is unavailable in the renderer.
 */
export function artifactHomeRelativeKey(normalized: string): string | null {
  const value = String(normalized || "").trim().replace(/\\/g, "/");
  if (!value) return null;
  if (value.startsWith("~/")) return value;
  const posix = value.match(/^\/(?:Users|home)\/[^/]+\/(.+)$/);
  if (posix?.[1]) return `~/${posix[1]}`;
  const win = value.match(/^[a-zA-Z]:\/Users\/[^/]+\/(.+)$/i);
  if (win?.[1]) return `~/${win[1]}`;
  return null;
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
  // Docs / templates like `~/.codewiki/<project>/` are not real artifacts.
  if (/[<>]/.test(value)) return null;
  if (!isAbsoluteFilePath(value) && !value.startsWith("/") && !/^[a-zA-Z]:[\\/]/.test(value) && !value.startsWith("~/")) {
    return null;
  }
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return normalized || null;
}

function addPath(paths: string[], seen: Set<string>, raw: string): void {
  const normalized = normalizeArtifactPath(raw);
  if (!normalized) return;

  // `~/Desktop/a.md` ≡ `/Users/<name>/Desktop/a.md` (string-level home-relative key).
  const relKey = artifactHomeRelativeKey(normalized);
  const keys = [normalized];
  if (relKey) keys.push(relKey);

  if (keys.some((k) => seen.has(k))) {
    // Upgrade a previously stored tilde path to the concrete absolute form.
    if (!normalized.startsWith("~/") && relKey) {
      const idx = paths.findIndex(
        (p) => p === relKey || artifactHomeRelativeKey(p) === relKey,
      );
      if (idx >= 0 && String(paths[idx] || "").startsWith("~/")) {
        paths[idx] = normalized;
        seen.add(normalized);
      }
    }
    return;
  }
  for (const k of keys) seen.add(k);
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

/** Pull absolute artifact files from bash stdout (echoed PNG:/GIF: paths, ls -lh, etc.). */
function extractAbsArtifactPathsFromText(
  content: string,
  paths: string[],
  seen: Set<string>,
): void {
  INLINE_ABS_PATH_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_ABS_PATH_RE.exec(content)) !== null) {
    const candidate = normalizeArtifactPath(match[1] ?? "");
    if (!candidate || !looksLikeArtifactFile(candidate)) continue;
    if (ARTIFACT_SOURCE_EXCLUDE_RE.test(candidate.replace(/\\/g, "/"))) continue;
    addPath(paths, seen, candidate);
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

/** True when a write-tool result body indicates failure (not merely in-flight). */
export function isFailedWriteResultText(text: string | undefined | null): boolean {
  const body = String(text ?? "");
  const trimmed = body.trimStart();
  if (trimmed.startsWith("ERROR:")) return true;
  if (body.includes("path escapes workspace")) return true;
  return false;
}

/**
 * True when a pane tool message must not contribute `toolArgs.path` as an artifact.
 * Explicit failure only — `toolStatus` undefined (history / agent_messages) is not failure.
 */
export function isFailedWriteToolMessage(message: Message): boolean {
  if (message.toolStatus === "error") return true;
  if (isFailedWriteResultText(message.content)) return true;
  if (isFailedWriteResultText(message.toolResultPreview)) return true;
  return false;
}

/**
 * Map persisted `agent_messages.json` rows into collector-friendly Message shapes.
 * Agent rows use OpenAI-style `name` + optional assistant `tool_calls`, while the
 * chat pane uses `toolName` / `toolArgs` — without this bridge, HTML writes that
 * only landed in agent_messages never appear under WorkPanel「任务产物」.
 */
export function agentMessageRowsToCollectorMessages(rows: unknown[] | undefined | null): Message[] {
  const out: Message[] = [];
  if (!Array.isArray(rows)) return out;

  // Pair assistant tool_calls with later role:tool results by tool_call_id.
  const toolResultsById = new Map<string, string>();
  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (String(r.role || "").trim() !== "tool") continue;
    const callId = String(r.tool_call_id || "").trim();
    if (!callId) continue;
    toolResultsById.set(callId, String(r.content ?? ""));
  }

  for (let i = 0; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const role = String(r.role || "").trim();

    if (role === "tool") {
      out.push({
        id: String(r.tool_call_id || r.id || `am-tool-${i}`),
        role: "tool",
        content: String(r.content ?? ""),
        toolName: String(r.name || r.tool_name || "").trim() || undefined,
        timestamp: 0,
      });
      continue;
    }

    if (role === "assistant") {
      out.push({
        id: String(r.id || `am-asst-${i}`),
        role: "assistant",
        content: String(r.content ?? ""),
        timestamp: 0,
      });
      const toolCalls = r.tool_calls;
      if (!Array.isArray(toolCalls)) continue;
      for (let j = 0; j < toolCalls.length; j += 1) {
        const tc = toolCalls[j];
        if (!tc || typeof tc !== "object") continue;
        const call = tc as Record<string, unknown>;
        const fn = call.function;
        if (!fn || typeof fn !== "object") continue;
        const fnObj = fn as Record<string, unknown>;
        const name = String(fnObj.name || "").trim();
        if (name !== "file_write" && name !== "file_edit") continue;
        let args: Record<string, unknown> = {};
        const rawArgs = fnObj.arguments;
        if (typeof rawArgs === "string" && rawArgs.trim()) {
          try {
            const parsed = JSON.parse(rawArgs) as unknown;
            if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
              args = parsed as Record<string, unknown>;
            }
          } catch {
            /* ignore malformed tool args */
          }
        } else if (rawArgs && typeof rawArgs === "object" && !Array.isArray(rawArgs)) {
          args = rawArgs as Record<string, unknown>;
        }
        // Only trust toolArgs.path when a matching tool result exists and succeeded.
        // In-flight calls (no result yet) and denied writes must not become artifacts.
        const callId = String(call.id || "").trim();
        const resultContent = callId ? toolResultsById.get(callId) : undefined;
        const nextArgs: Record<string, unknown> = { ...args };
        const argPath = String(args.path ?? "").trim();
        if (argPath) {
          if (resultContent === undefined || isFailedWriteResultText(resultContent)) {
            delete nextArgs.path;
          }
        }
        out.push({
          id: String(call.id || `am-tc-${i}-${j}`),
          role: "tool",
          toolName: name,
          toolArgs: nextArgs,
          content: "",
          timestamp: 0,
        });
      }
    }
  }
  return out;
}

/** Collect artifact paths from raw `agent_messages.json` rows. */
export function collectArtifactPathsFromAgentMessages(
  rows: unknown[] | undefined | null,
): string[] {
  return collectSessionArtifactPaths(agentMessageRowsToCollectorMessages(rows));
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
        // Denied / failed writes must not become auto-mount inputs (privilege escalation).
        if (!isFailedWriteToolMessage(message)) {
          const argPath = String(message.toolArgs?.path ?? "").trim();
          if (argPath) addPath(paths, seen, argPath);
        }
        extractOkWritePaths(String(message.content || ""), paths, seen);
        extractOkWritePaths(String(message.toolResultPreview || ""), paths, seen);
      } else if (toolName === "bash_exec") {
        const command = String(message.toolArgs?.command ?? "").trim();
        if (command) extractBashRedirectPaths(command, paths, seen);
        extractJsonOutputArtifactPaths(String(message.content || ""), paths, seen);
        extractJsonOutputArtifactPaths(String(message.toolResultPreview || ""), paths, seen);
        extractAbsArtifactPathsFromText(String(message.content || ""), paths, seen);
        extractAbsArtifactPathsFromText(String(message.toolResultPreview || ""), paths, seen);
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

export function isPreviewImageArtifactPath(path: string): boolean {
  const base = artifactBaseName(path).toLowerCase();
  const ext = base.match(/\.([a-z0-9]{1,12})$/)?.[1] ?? "";
  return Object.prototype.hasOwnProperty.call(PREVIEW_IMAGE_RANK, ext);
}

function previewImageRank(path: string): number {
  const base = artifactBaseName(path).toLowerCase();
  const ext = base.match(/\.([a-z0-9]{1,12})$/)?.[1] ?? "";
  return PREVIEW_IMAGE_RANK[ext] ?? 99;
}

/**
 * Same-stem PNG/GIF/SVG → keep the most useful preview (animated GIF first).
 * Non-image paths are dropped.
 */
export function preferAnimatedPreviewImages(paths: string[]): string[] {
  const groups = new Map<string, string[]>();
  const order: string[] = [];
  for (const raw of paths) {
    const path = String(raw || "").trim();
    if (!path || !isPreviewImageArtifactPath(path)) continue;
    const normalized = path.replace(/\\/g, "/");
    const base = artifactBaseName(normalized);
    const stem = base.replace(/\.[a-zA-Z0-9]{1,12}$/, "");
    const dir = normalized.slice(0, Math.max(0, normalized.length - base.length));
    const key = `${dir}${stem}`;
    const bucket = groups.get(key);
    if (!bucket) {
      groups.set(key, [path]);
      order.push(key);
    } else {
      bucket.push(path);
    }
  }
  return order.map((key) => {
    const files = groups.get(key) ?? [];
    files.sort((a, b) => previewImageRank(a) - previewImageRank(b));
    return files[0] ?? "";
  }).filter(Boolean);
}

/** Inject `![name](path)` for generated images not already present in markdown. */
export function appendMissingImageMarkdown(content: string, imagePaths: string[]): string {
  const body = String(content || "");
  const missing = imagePaths.filter((raw) => {
    const path = String(raw || "").trim();
    if (!path) return false;
    return !body.includes(`](${path})`);
  });
  if (missing.length === 0) return body;
  const block = missing.map((path) => `![${artifactBaseName(path)}](${path})`).join("\n\n");
  return `${body.replace(/\s+$/, "")}\n\n${block}`;
}

/** Image previews produced in the same user turn as this assistant message. */
export function collectTurnPreviewImagePaths(
  messages: Message[] | undefined | null,
  assistantMessageId: string,
): string[] {
  const list = messages ?? [];
  const idx = list.findIndex((row) => row.id === assistantMessageId);
  if (idx < 0) return [];
  // Only the last assistant in the turn should embed the gallery (avoid duplicates).
  for (let i = idx + 1; i < list.length; i += 1) {
    if (list[i]?.role === "user") break;
    if (list[i]?.role === "assistant") return [];
  }
  let start = 0;
  for (let i = idx - 1; i >= 0; i -= 1) {
    if (list[i]?.role === "user") {
      start = i + 1;
      break;
    }
  }
  return preferAnimatedPreviewImages(collectSessionArtifactPaths(list.slice(start, idx + 1)));
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
