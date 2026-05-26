import { spawn, execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { shell } from "electron";

const execFileAsync = promisify(execFile);

export type SystemSearchCategory =
  | "all"
  | "documents"
  | "applications"
  | "images"
  | "folders"
  | "videos";

export type SystemSearchKind =
  | "folder"
  | "document"
  | "application"
  | "image"
  | "video"
  | "other";

export type SystemSearchItem = {
  path: string;
  name: string;
  ext: string;
  kind: SystemSearchKind;
  size: number;
  mtime: number;
};

export type SystemSearchResult = {
  ok: boolean;
  items: SystemSearchItem[];
  error?: string;
  warning?: string;
  timedOut?: boolean;
  engine?: string;
};

export type SystemSearchPreviewResult = {
  ok: boolean;
  kind: "text" | "image" | "metadata";
  content?: string;
  fileUrl?: string;
  truncated?: boolean;
  error?: string;
};

const SEARCH_TIMEOUT_MS = 5000;
const MAX_RESULTS = 200;
const PREVIEW_MAX_BYTES = 64 * 1024;
const PREVIEW_MAX_FILE_BYTES = 5 * 1024 * 1024;

const DOC_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".pdf",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".xls",
  ".xlsx",
  ".csv",
  ".rtf",
  ".json",
  ".yaml",
  ".yml",
]);

const TEXT_PREVIEW_EXTENSIONS = new Set([
  ".md",
  ".txt",
  ".json",
  ".yaml",
  ".yml",
  ".csv",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".scss",
  ".less",
  ".js",
  ".jsx",
  ".ts",
  ".tsx",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".sh",
  ".bash",
  ".zsh",
  ".sql",
  ".toml",
  ".ini",
  ".env",
  ".log",
]);

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".heic", ".ico"]);

const VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".wmv", ".flv"]);

const NOISE_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  ".Trash",
  ".trash",
  "__pycache__",
  ".npm",
  ".cache",
  ".venv",
  "venv",
  ".cursor",
  "Application Support",
  "Caches",
  "Containers",
]);

function defaultSearchRoots(): string[] {
  const home = os.homedir();
  return [
    home,
    path.join(home, "Desktop"),
    path.join(home, "Documents"),
    path.join(home, "Downloads"),
  ];
}

function escapeMdfindToken(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function basenameNoExt(filePath: string): string {
  const base = path.basename(filePath);
  const ext = path.extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

function inferKind(filePath: string, isDirectory: boolean): SystemSearchKind {
  if (filePath.toLowerCase().endsWith(".app")) return "application";
  if (isDirectory) return "folder";
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".app") return "application";
  if (IMAGE_EXTENSIONS.has(ext)) return "image";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (DOC_EXTENSIONS.has(ext)) return "document";
  return "other";
}

function shouldSkipPath(filePath: string): boolean {
  const parts = filePath.split(path.sep);
  if (parts.some((part) => NOISE_DIR_NAMES.has(part))) return true;
  // Spotlight / walk：跳过 Library，避免 Cursor/Chrome 等噪声路径
  if (parts.includes("Library")) return true;
  return false;
}

function statItem(filePath: string, isDirectory = false): SystemSearchItem | null {
  try {
    const st = fs.statSync(filePath);
    const isDir = st.isDirectory() || isDirectory;
    const name = path.basename(filePath);
    const ext = isDir ? "" : path.extname(name).toLowerCase();
    return {
      path: filePath,
      name,
      ext,
      kind: inferKind(filePath, isDir),
      size: isDir ? 0 : st.size,
      mtime: st.mtimeMs,
    };
  } catch {
    return null;
  }
}

function filterByCategory(items: SystemSearchItem[], category: SystemSearchCategory): SystemSearchItem[] {
  if (category === "all") return items;
  if (category === "folders") return items.filter((item) => item.kind === "folder");
  if (category === "documents") return items.filter((item) => item.kind === "document");
  if (category === "applications") return items.filter((item) => item.kind === "application");
  if (category === "images") return items.filter((item) => item.kind === "image");
  if (category === "videos") return items.filter((item) => item.kind === "video");
  return items;
}

function dedupeAndLimit(items: SystemSearchItem[]): SystemSearchItem[] {
  const seen = new Set<string>();
  const out: SystemSearchItem[] = [];
  for (const item of items) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    out.push(item);
    if (out.length >= MAX_RESULTS) break;
  }
  return out;
}

async function runSpawn(
  command: string,
  args: string[],
  timeoutMs = SEARCH_TIMEOUT_MS
): Promise<{ stdout: string; stderr: string; timedOut: boolean }> {
  return await new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("close", () => {
      clearTimeout(timer);
      resolve({ stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: `${stderr}\n${String(err)}`.trim(), timedOut });
    });
  });
}

async function which(command: string): Promise<string | null> {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      const { stdout } = await execFileAsync("where", [command], { timeout: 2000 });
      const line = stdout.split(/\r?\n/).find((row) => row.trim());
      return line?.trim() ?? null;
    }
    const { stdout } = await execFileAsync("which", [command], { timeout: 2000 });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

function parsePathLines(stdout: string): string[] {
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function kindCategoryFilter(category: SystemSearchCategory): (item: SystemSearchItem) => boolean {
  return (item) => {
    if (category === "all") return true;
    if (category === "folders") return item.kind === "folder";
    if (category === "documents") return item.kind === "document";
    if (category === "applications") return item.kind === "application";
    if (category === "images") return item.kind === "image";
    if (category === "videos") return item.kind === "video";
    return true;
  };
}

async function walkSearchByName(
  query: string,
  category: SystemSearchCategory,
  options: { maxDepth?: number; timeoutMs?: number; roots?: string[] } = {}
): Promise<{ items: SystemSearchItem[]; timedOut: boolean }> {
  const maxDepth = options.maxDepth ?? 6;
  const timeoutMs = options.timeoutMs ?? SEARCH_TIMEOUT_MS;
  const roots = options.roots ?? defaultSearchRoots();
  const needle = query.trim().toLowerCase();
  if (!needle) return { items: [], timedOut: false };

  const found: SystemSearchItem[] = [];
  const seenRoots = new Set<string>();

  async function walk(dir: string, depth: number): Promise<void> {
    if (found.length >= MAX_RESULTS || depth > maxDepth) return;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (found.length >= MAX_RESULTS) return;
      if (NOISE_DIR_NAMES.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (shouldSkipPath(full)) continue;
      const nameMatch = entry.name.toLowerCase().includes(needle);
      if (entry.isDirectory()) {
        if (nameMatch) {
          const item = statItem(full, true);
          if (item) found.push(item);
        }
        await walk(full, depth + 1);
      } else if (nameMatch) {
        const item = statItem(full, false);
        if (item) found.push(item);
      }
    }
  }

  const started = Date.now();
  for (const root of roots) {
    if (Date.now() - started > timeoutMs) break;
    const resolved = path.resolve(root);
    if (seenRoots.has(resolved)) continue;
    seenRoots.add(resolved);
    await walk(resolved, 0);
  }

  const timedOut = Date.now() - started >= timeoutMs;
  const items = dedupeAndLimit(found.filter(kindCategoryFilter(category)));
  return { items, timedOut };
}

async function searchMacMdfind(
  query: string,
  category: SystemSearchCategory
): Promise<{ paths: string[]; timedOut: boolean; stderr: string }> {
  const token = escapeMdfindToken(query.trim());
  if (!token) return { paths: [], timedOut: false, stderr: "" };

  let expr = `(kMDItemDisplayName == "*${token}*"cd || kMDItemFSName == "*${token}*"cd)`;
  if (category === "folders") {
    expr = `(kMDItemContentType == "public.folder") && (${expr})`;
  } else if (category === "documents") {
    expr = `(kMDItemContentTypeTree == "public.content") && (${expr})`;
  } else if (category === "applications") {
    expr = `(kMDItemContentType == "com.apple.application-bundle") && (${expr})`;
  } else if (category === "images") {
    expr = `(kMDItemContentTypeTree == "public.image") && (${expr})`;
  } else if (category === "videos") {
    expr = `(kMDItemContentTypeTree == "public.movie") && (${expr})`;
  }

  const { stdout, stderr, timedOut } = await runSpawn("mdfind", [expr]);
  const paths = parsePathLines(stdout).filter((p) => !shouldSkipPath(p));
  return { paths, timedOut, stderr };
}

async function searchMac(query: string, category: SystemSearchCategory): Promise<SystemSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: true, items: [], engine: "mdfind+walk" };

  const [mdfindRes, walkRes] = await Promise.all([
    searchMacMdfind(trimmed, "all"),
    walkSearchByName(trimmed, "all", { maxDepth: 6 }),
  ]);

  const mergedItems: SystemSearchItem[] = [];
  const seen = new Set<string>();
  for (const filePath of mdfindRes.paths) {
    if (seen.has(filePath)) continue;
    const item = statItem(filePath);
    if (!item) continue;
    seen.add(filePath);
    mergedItems.push(item);
  }
  for (const item of walkRes.items) {
    if (seen.has(item.path)) continue;
    seen.add(item.path);
    mergedItems.push(item);
  }

  const items = filterByCategory(dedupeAndLimit(mergedItems), category);
  const timedOut = mdfindRes.timedOut || walkRes.timedOut;

  return {
    ok: true,
    items,
    timedOut,
    engine: "mdfind+walk",
    error: timedOut ? "搜索超时（5s），请缩小关键词" : mdfindRes.stderr.trim() || undefined,
  };
}

async function findEverythingExe(): Promise<string | null> {
  const candidates = [
    "es.exe",
    path.join(process.env.ProgramFiles ?? "", "Everything", "es.exe"),
    path.join(process.env["ProgramFiles(x86)"] ?? "", "Everything", "es.exe"),
    path.join(process.env.LOCALAPPDATA ?? "", "Everything", "es.exe"),
  ];
  for (const candidate of candidates) {
    if (candidate === "es.exe") {
      const resolved = await which("es.exe");
      if (resolved) return resolved;
      continue;
    }
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

async function searchWindowsEverything(
  exePath: string,
  query: string,
  category: SystemSearchCategory
): Promise<SystemSearchItem[]> {
  const args = ["-n", "200", query];
  if (category === "folders") args.push("-attr", "D");
  const { stdout, timedOut } = await runSpawn(exePath, args);
  if (timedOut) return [];
  const paths = parsePathLines(stdout).filter((p) => !shouldSkipPath(p));
  return dedupeAndLimit(
    paths
      .map((p) => statItem(p))
      .filter((item): item is SystemSearchItem => item !== null)
      .filter(kindCategoryFilter(category))
  );
}

async function searchWindowsFallback(query: string, category: SystemSearchCategory): Promise<SystemSearchResult> {
  const { items, timedOut } = await walkSearchByName(query, category, { maxDepth: 4 });
  return {
    ok: true,
    items,
    timedOut,
    engine: "walk-fallback",
    warning: "未检测到 Everything，已使用慢速 fallback；建议安装 Everything 获得更快搜索",
  };
}

async function searchWindows(query: string, category: SystemSearchCategory): Promise<SystemSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: true, items: [], engine: "everything" };

  const everything = await findEverythingExe();
  if (everything) {
    const items = await searchWindowsEverything(everything, trimmed, category);
    return { ok: true, items, engine: "everything" };
  }
  return searchWindowsFallback(trimmed, category);
}

async function searchLinuxFd(query: string, category: SystemSearchCategory): Promise<SystemSearchItem[] | null> {
  const fdPath = await which("fd");
  if (!fdPath) return null;
  const args = ["--max-results", String(MAX_RESULTS), "--ignore-case", query, os.homedir()];
  const { stdout, timedOut } = await runSpawn(fdPath, args);
  if (timedOut) return [];
  const paths = parsePathLines(stdout).filter((p) => !shouldSkipPath(p));
  return dedupeAndLimit(
    paths
      .map((p) => statItem(p))
      .filter((item): item is SystemSearchItem => item !== null)
      .filter(kindCategoryFilter(category))
  );
}

async function searchLinuxLocate(query: string, category: SystemSearchCategory): Promise<SystemSearchItem[] | null> {
  const locatePath = await which("locate");
  if (!locatePath) return null;
  const { stdout, timedOut } = await runSpawn(locatePath, ["-i", query]);
  if (timedOut) return [];
  const home = os.homedir();
  const paths = parsePathLines(stdout)
    .filter((p) => p.startsWith(home))
    .filter((p) => !shouldSkipPath(p))
    .slice(0, MAX_RESULTS * 2);
  return dedupeAndLimit(
    paths
      .map((p) => statItem(p))
      .filter((item): item is SystemSearchItem => item !== null)
      .filter(kindCategoryFilter(category))
  );
}

async function searchLinuxFind(query: string, category: SystemSearchCategory): Promise<SystemSearchResult> {
  const { items, timedOut } = await walkSearchByName(query, category, {
    maxDepth: 4,
    roots: [os.homedir()],
  });
  return {
    ok: true,
    items,
    timedOut,
    engine: "find-fallback",
    warning: "未检测到 fd/locate，已使用慢速目录扫描",
  };
}

async function searchLinux(query: string, category: SystemSearchCategory): Promise<SystemSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: true, items: [], engine: "fd" };

  const fdItems = await searchLinuxFd(trimmed, category);
  if (fdItems) return { ok: true, items: fdItems, engine: "fd" };

  const locateItems = await searchLinuxLocate(trimmed, category);
  if (locateItems) return { ok: true, items: locateItems, engine: "locate" };

  return searchLinuxFind(trimmed, category);
}

export async function runSystemSearch(
  query: string,
  category: SystemSearchCategory = "all"
): Promise<SystemSearchResult> {
  const trimmed = query.trim();
  if (!trimmed) return { ok: true, items: [] };

  try {
    if (process.platform === "darwin") return await searchMac(trimmed, category);
    if (process.platform === "win32") return await searchWindows(trimmed, category);
    return await searchLinux(trimmed, category);
  } catch (error) {
    return { ok: false, items: [], error: String(error) };
  }
}

export async function previewSystemSearchFile(filePath: string): Promise<SystemSearchPreviewResult> {
  try {
    const resolved = path.resolve(filePath);
    const st = await fs.promises.stat(resolved);
    if (st.isDirectory()) {
      return {
        ok: true,
        kind: "metadata",
        content: `文件夹\n${resolved}`,
      };
    }
    if (st.size > PREVIEW_MAX_FILE_BYTES) {
      return { ok: false, kind: "metadata", error: "文件超过 5MB，无法预览" };
    }

    const ext = path.extname(resolved).toLowerCase();
    if (IMAGE_EXTENSIONS.has(ext)) {
      return { ok: true, kind: "image", fileUrl: `file://${resolved}` };
    }
    if (TEXT_PREVIEW_EXTENSIONS.has(ext) || ext === "") {
      const buf = await fs.promises.readFile(resolved);
      const truncated = buf.length > PREVIEW_MAX_BYTES;
      const slice = truncated ? buf.subarray(0, PREVIEW_MAX_BYTES) : buf;
      return {
        ok: true,
        kind: "text",
        content: slice.toString("utf8"),
        truncated,
      };
    }
    return {
      ok: true,
      kind: "metadata",
      content: `${ext || "文件"}\n大小：${st.size} 字节\n修改时间：${new Date(st.mtimeMs).toLocaleString()}`,
    };
  } catch (error) {
    return { ok: false, kind: "metadata", error: String(error) };
  }
}

export async function openSystemSearchPath(filePath: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const err = await shell.openPath(filePath);
    if (err) return { ok: false, error: err };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export async function revealSystemSearchPath(filePath: string): Promise<{ ok: boolean; error?: string }> {
  try {
    shell.showItemInFolder(path.resolve(filePath));
    return { ok: true };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

function escapeAppleScriptPath(filePath: string): string {
  return filePath.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** macOS Finder Get Info; other platforms fall back to reveal in file manager. */
export async function getSystemSearchInfo(filePath: string): Promise<{ ok: boolean; error?: string }> {
  const resolved = path.resolve(filePath);
  if (process.platform === "darwin") {
    try {
      const script = `tell application "Finder" to open information window of (POSIX file "${escapeAppleScriptPath(resolved)}" as alias)`;
      await execFileAsync("osascript", ["-e", script]);
      return { ok: true };
    } catch (error) {
      const fallback = await revealSystemSearchPath(filePath);
      if (fallback.ok) return { ok: true };
      return { ok: false, error: String(error) };
    }
  }
  return revealSystemSearchPath(filePath);
}

/** Open-with picker (Windows) or reveal + hint (macOS/Linux). */
export async function openSystemSearchWith(
  filePath: string
): Promise<{ ok: boolean; hint?: string; error?: string }> {
  const resolved = path.resolve(filePath);
  try {
    const st = await fs.promises.stat(resolved);
    if (st.isDirectory()) {
      const reveal = await revealSystemSearchPath(filePath);
      return reveal.ok
        ? { ok: true, hint: "文件夹请在访达/资源管理器中右键选择打开方式" }
        : reveal;
    }
    if (process.platform === "win32") {
      await execFileAsync("rundll32.exe", ["shell32.dll,OpenAs_RunDLL", resolved]);
      return { ok: true };
    }
    const reveal = await revealSystemSearchPath(filePath);
    if (!reveal.ok) return reveal;
    return {
      ok: true,
      hint:
        process.platform === "darwin"
          ? "请在访达中右键该文件选择打开方式"
          : "当前平台不支持打开方式选择，已在文件管理器中定位",
    };
  } catch (error) {
    return { ok: false, error: String(error) };
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes <= 0) return "—";
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
}

export function kindLabel(kind: SystemSearchKind): string {
  switch (kind) {
    case "folder":
      return "文件夹";
    case "document":
      return "文档";
    case "application":
      return "应用";
    case "image":
      return "图片";
    case "video":
      return "视频";
    default:
      return "其他";
  }
}

export { basenameNoExt };
