import fs from "fs";
import path from "path";

export type MetaWorkspaceHistoryKind = "identity" | "soul";

const MAX_SNAPSHOTS = 10;
const PREVIEW_LEN = 100;

export function parseMetaWorkspaceHistoryKind(raw: unknown): MetaWorkspaceHistoryKind | null {
  if (raw === "identity" || raw === "soul") return raw;
  return null;
}

export function resolveMetaWorkspaceMainPath(
  workspaceDir: string,
  kind: MetaWorkspaceHistoryKind,
): string {
  const filename = kind === "identity" ? "IDENTITY.md" : "SOUL.md";
  return path.join(workspaceDir, filename);
}

export function resolveHistoryDir(workspaceDir: string, kind: MetaWorkspaceHistoryKind): string {
  return path.join(workspaceDir, ".history", kind);
}

function readFileUtf8(filePath: string): string {
  try {
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return "";
  }
}

function formatTimestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

function previewContent(content: string): string {
  const oneLine = content.replace(/\s+/g, " ").trim();
  if (oneLine.length <= PREVIEW_LEN) return oneLine;
  return `${oneLine.slice(0, PREVIEW_LEN)}…`;
}

function formatSavedAtFromId(id: string): string {
  const m = id.match(/^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})$/);
  if (!m) return id;
  return `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
}

function pruneHistory(historyDir: string): void {
  if (!fs.existsSync(historyDir)) return;
  const files = fs
    .readdirSync(historyDir)
    .filter((f) => f.endsWith(".md"))
    .sort();
  while (files.length > MAX_SNAPSHOTS) {
    const oldest = files.shift();
    if (!oldest) break;
    try {
      fs.unlinkSync(path.join(historyDir, oldest));
    } catch {
      // ignore prune failures
    }
  }
}

/** Snapshot disk content before overwrite when saving from settings UI. */
export function snapshotMetaWorkspaceBeforeSave(
  workspaceDir: string,
  kind: MetaWorkspaceHistoryKind,
  newContent: string,
): void {
  const mainPath = resolveMetaWorkspaceMainPath(workspaceDir, kind);
  const old = readFileUtf8(mainPath);
  const next = String(newContent ?? "");
  if (old === next || old.trim().length === 0) return;

  const historyDir = resolveHistoryDir(workspaceDir, kind);
  fs.mkdirSync(historyDir, { recursive: true });
  const filename = `${formatTimestamp()}.md`;
  fs.writeFileSync(path.join(historyDir, filename), old, "utf-8");
  pruneHistory(historyDir);
}

export type MetaWorkspaceHistoryItem = {
  id: string;
  savedAt: string;
  preview: string;
};

export function listMetaWorkspaceHistory(
  workspaceDir: string,
  kind: MetaWorkspaceHistoryKind,
): MetaWorkspaceHistoryItem[] {
  const historyDir = resolveHistoryDir(workspaceDir, kind);
  if (!fs.existsSync(historyDir)) return [];

  const files = fs
    .readdirSync(historyDir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .reverse();

  return files.map((filename) => {
    const id = filename.replace(/\.md$/, "");
    const content = readFileUtf8(path.join(historyDir, filename));
    return {
      id,
      savedAt: formatSavedAtFromId(id),
      preview: previewContent(content),
    };
  });
}

export function restoreMetaWorkspaceHistory(
  workspaceDir: string,
  kind: MetaWorkspaceHistoryKind,
  id: string,
): { ok: true; content: string } | { ok: false; error: string } {
  const safeId = String(id ?? "").trim();
  if (!safeId || !/^\d{8}-\d{6}$/.test(safeId)) {
    return { ok: false, error: "invalid history id" };
  }

  const historyPath = path.join(resolveHistoryDir(workspaceDir, kind), `${safeId}.md`);
  if (!fs.existsSync(historyPath)) {
    return { ok: false, error: "history not found" };
  }

  const content = readFileUtf8(historyPath);
  const mainPath = resolveMetaWorkspaceMainPath(workspaceDir, kind);
  fs.mkdirSync(path.dirname(mainPath), { recursive: true });
  fs.writeFileSync(mainPath, content, "utf-8");
  return { ok: true, content };
}
