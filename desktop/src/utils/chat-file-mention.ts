/** Build composer mention text for a file reference (matches WorkspacePanel @ injection). */
export function buildFileMentionAppend(
  base: string,
  fileName: string,
  options?: { mentionText?: string }
): { next: string; tokenNames: string[] } {
  const mentionLabel = String(options?.mentionText || fileName).trim() || fileName;
  const mention = `@${mentionLabel}`;
  const trimmed = base.trimEnd();
  const sep = !trimmed || /\s$/.test(base) ? "" : " ";
  return { next: `${base}${sep}${mention} `, tokenNames: [mentionLabel] };
}

export function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).pop() || filePath;
}

/** Remove `:534-534` / `(534-534)` line-range suffixes from a filesystem path or @ label. */
export function stripLineRangeFromAbsPath(path: string): string {
  return String(path || "")
    .trim()
    .replace(/\((\d+)-(\d+)\)\s*$/, "")
    .replace(/\s+:(\d+)-(\d+)$/, "")
    .replace(/:(\d+)-(\d+)$/, "");
}

/** Parent directory hint for reference chips (e.g. `~/Downloads`). */
export function formatReferencePathHint(absPath: string): string {
  const norm = String(absPath || "")
    .trim()
    .replace(/\\/g, "/");
  if (!norm) return "";
  const idx = norm.lastIndexOf("/");
  if (idx <= 0) return norm;
  const parent = norm.slice(0, idx);
  const parts = parent.split("/").filter(Boolean);
  if (parts.length >= 3 && parts[0] === "Users") {
    return `~/${parts.slice(2).join("/")}`;
  }
  if (parts.length >= 2) return parts.slice(-2).join("/");
  return parent;
}

export function resolveReferenceSourcePath(name: string, sourcePath?: string): string {
  const sp = stripLineRangeFromAbsPath(
    String(sourcePath || "")
      .trim()
      .replace(/\\/g, "/")
  );
  if (sp) return sp;
  const label = stripLineRangeFromAbsPath(
    String(name || "")
      .trim()
      .replace(/\\/g, "/")
  );
  if (label.includes("/") || label.includes("\\")) return label;
  return "";
}

export function referenceChipTitle(name: string, sourcePath?: string): string {
  const resolved = resolveReferenceSourcePath(name, sourcePath);
  return resolved || `@${name}`;
}

function parseLineRangeFromChipLabel(label: string): { start: number; end: number } | undefined {
  const text = String(label || "").trim();
  if (!text) return undefined;
  const colonMatch = text.match(/:(\d+)-(\d+)$/);
  if (colonMatch) {
    const start = Math.max(1, parseInt(colonMatch[1]!, 10));
    const end = Math.max(start, parseInt(colonMatch[2]!, 10));
    return { start, end };
  }
  const parenMatch = text.match(/\((\d+)-(\d+)\)$/);
  if (parenMatch) {
    const start = Math.max(1, parseInt(parenMatch[1]!, 10));
    const end = Math.max(start, parseInt(parenMatch[2]!, 10));
    return { start, end };
  }
  return undefined;
}

/** Chip label: basename + optional line range; full path stays in sourcePath / API payload only. */
export function formatReferenceChipLabel(
  name: string,
  sourcePath?: string,
  lineRange?: { start: number; end: number }
): string {
  const label = String(name || "").trim();
  const range = lineRange ?? parseLineRangeFromChipLabel(label);
  const baseSource =
    label.includes("/") || label.includes("\\")
      ? label.replace(/:(\d+)-(\d+)$/, "").replace(/\((\d+)-(\d+)\)$/, "").trim()
      : String(sourcePath || "").trim() || label.replace(/:(\d+)-(\d+)$/, "").replace(/\((\d+)-(\d+)\)$/, "").trim();
  const baseName = fileNameFromPath(baseSource.replace(/\\/g, "/")) || label;
  if (range) {
    return `${baseName} (${range.start}-${range.end})`;
  }
  return baseName;
}

/** Map @ chip label → absolute path for composer tooltips and token metadata. */
export function buildComposerRefPathLookup(
  entries: Array<{
    key: string;
    name?: string;
    sourcePath?: string;
    composerRefLabel?: string;
  }>,
  extra?: Record<string, string>
): Record<string, string> {
  const out: Record<string, string> = { ...(extra ?? {}) };
  for (const entry of entries) {
    const sp = resolveReferenceSourcePath(entry.name || "", entry.sourcePath || entry.key);
    if (!sp) continue;
    for (const label of [entry.composerRefLabel, entry.name, fileNameFromPath(sp)]) {
      const trimmed = String(label || "").trim();
      if (trimmed) out[trimmed] = sp;
    }
  }
  return out;
}

export function lookupComposerRefPath(
  lookup: Record<string, string>,
  label: string
): string | undefined {
  const needle = String(label || "").trim();
  if (!needle) return undefined;
  if (lookup[needle]) return lookup[needle];
  const lower = needle.toLowerCase();
  for (const [key, value] of Object.entries(lookup)) {
    if (key.toLowerCase() === lower) return value;
  }
  return undefined;
}

export function parentFolderPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return filePath;
  return filePath.slice(0, idx);
}
