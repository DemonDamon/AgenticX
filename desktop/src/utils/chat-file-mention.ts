/** Build composer mention text for a file reference (matches WorkspacePanel @ injection). */
export function buildFileMentionAppend(base: string, fileName: string): { next: string; tokenNames: string[] } {
  const mention = `@${fileName}`;
  const trimmed = base.trimEnd();
  const sep = !trimmed || /\s$/.test(base) ? "" : " ";
  return { next: `${base}${sep}${mention} `, tokenNames: [fileName] };
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
