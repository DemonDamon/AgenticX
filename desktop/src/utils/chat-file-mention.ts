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

export function parentFolderPath(filePath: string): string {
  const normalized = filePath.replace(/\\/g, "/");
  const idx = normalized.lastIndexOf("/");
  if (idx <= 0) return filePath;
  return filePath.slice(0, idx);
}
