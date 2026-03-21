/** Clipboard image extraction for chat attachment paste. */

function dedupeKey(file: File): string {
  return `${file.name}:${file.size}:${file.lastModified}`;
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

/**
 * Collect image/* files from a paste event's clipboardData (files + items).
 */
export function extractClipboardImageFiles(data: DataTransfer | null): File[] {
  if (!data) return [];
  const seen = new Set<string>();
  const out: File[] = [];

  const consider = (file: File | null) => {
    if (!file || !file.type.startsWith("image/")) return;
    const key = dedupeKey(file);
    if (seen.has(key)) return;
    seen.add(key);
    out.push(file);
  };

  if (data.files?.length) {
    for (const f of Array.from(data.files)) {
      consider(f);
    }
  }
  if (data.items?.length) {
    for (const item of Array.from(data.items)) {
      if (item.kind === "file" && item.type.startsWith("image/")) {
        consider(item.getAsFile());
      }
    }
  }
  return out;
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
