/** Clipboard image extraction for chat attachment paste. */

/** Same logical image often appears in both `files` and `items`; lastModified may differ between them. */
function dedupeKeyByNameAndSize(file: File): string {
  return `${file.name}:${file.size}`;
}

function extensionForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  if (m.includes("bmp")) return "bmp";
  return "png";
}

function dedupeImageFiles(files: File[]): File[] {
  const seen = new Set<string>();
  const out: File[] = [];
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const key = dedupeKeyByNameAndSize(file);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(file);
  }
  return out;
}

/**
 * Collect image/* from a paste event. Prefer `files` only when it contains any image:
 * Chromium/Electron duplicates the same paste in `items`, and merging both yields two attachments.
 */
export function extractClipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];

  const fromFiles: File[] = [];
  if (data.files?.length) {
    for (const f of Array.from(data.files)) {
      if (f.type.startsWith("image/")) fromFiles.push(f);
    }
  }
  if (fromFiles.length > 0) {
    return dedupeImageFiles(fromFiles);
  }

  const fromItems: File[] = [];
  if (data.items?.length) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        const f = item.getAsFile();
        if (f) fromItems.push(f);
      }
    }
  }
  return dedupeImageFiles(fromItems);
}

/**
 * Ensure each image has a non-empty filename for stable attachment keys.
 */
export function withClipboardImageNames(files: File[]): File[] {
  const stamp = Date.now();
  return files.map((file, i) => {
    if (file.name?.trim()) return file;
    const ext = extensionForMime(file.type || "image/png");
    return new File([file], `clipboard-paste-${stamp}-${i}.${ext}`, {
      type: file.type || "image/png",
      lastModified: file.lastModified,
    });
  });
}
