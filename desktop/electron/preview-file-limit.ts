import os from "node:os";

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

/** Weak hosts stay at or below the original 25MB data-URL budget. */
export const PREVIEW_LIMIT_FLOOR_BYTES = 16 * MiB;
export const PREVIEW_LIMIT_DEFAULT_BYTES = 25 * MiB;
export const PREVIEW_LIMIT_MID_BYTES = 64 * MiB;
export const PREVIEW_LIMIT_HIGH_BYTES = 120 * MiB;

export type PreviewHostMemory = {
  totalBytes: number;
  freeBytes: number;
};

/**
 * Size cap for `load-local-file-data-url`.
 * The IPC reads the whole file and encodes it as a base64 data URL, so the
 * renderer cost is several times the on-disk size. Scale with RAM, but never
 * spend more than 10% of currently free memory.
 */
export function previewMaxBytesForMemory({
  totalBytes,
  freeBytes,
}: PreviewHostMemory): number {
  const safeTotal = Number.isFinite(totalBytes) ? Math.max(0, totalBytes) : 0;
  const safeFree = Number.isFinite(freeBytes) ? Math.max(0, freeBytes) : 0;

  let budget = PREVIEW_LIMIT_FLOOR_BYTES;
  if (safeTotal >= 32 * GiB) budget = PREVIEW_LIMIT_HIGH_BYTES;
  else if (safeTotal >= 16 * GiB) budget = PREVIEW_LIMIT_MID_BYTES;
  else if (safeTotal >= 8 * GiB) budget = PREVIEW_LIMIT_DEFAULT_BYTES;

  const freeCap = Math.max(PREVIEW_LIMIT_FLOOR_BYTES, Math.floor(safeFree * 0.1));
  return Math.min(budget, freeCap);
}

export function readPreviewHostMemory(): PreviewHostMemory {
  return { totalBytes: os.totalmem(), freeBytes: os.freemem() };
}

export function previewMaxBytesForHost(
  readMemory: () => PreviewHostMemory = readPreviewHostMemory,
): number {
  return previewMaxBytesForMemory(readMemory());
}

export function previewLimitExceededMessage(limitBytes: number): string {
  const mb = Math.max(1, Math.round(limitBytes / (1024 * 1024)));
  return `文件超过本机预览上限（${mb}MB），可在系统应用中打开`;
}
