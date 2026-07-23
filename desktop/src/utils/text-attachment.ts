/** Detect local text-like attachments for composer parse + context_files. */

const TEXT_EXTENSIONS = [
  ".py",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".txt",
  ".yaml",
  ".yml",
  ".sh",
  ".bash",
  ".toml",
  ".xml",
  ".csv",
  ".sql",
  ".html",
  ".htm",
  ".css",
  ".svg",
] as const;

export function isLikelyTextFile(file: Pick<File, "name" | "type">): boolean {
  const mime = String(file.type || "").trim().toLowerCase();
  if (mime.startsWith("text/")) return true;
  const lower = String(file.name || "").toLowerCase();
  return TEXT_EXTENSIONS.some((ext) => lower.endsWith(ext));
}
