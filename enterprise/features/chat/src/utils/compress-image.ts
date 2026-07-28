import { MAX_IMAGE_DATA_URL_CHARS } from "../types/composer-attachment";

export type CompressImageResult = {
  dataUrl: string;
  mimeType: string;
  size: number;
};

const MAX_EDGE = 2048;
const QUALITIES = [0.85, 0.75, 0.65, 0.55, 0.5];

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("图片编码失败"));
    };
    reader.onerror = () => reject(new Error("图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

function scaleSize(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/**
 * Downscale + JPEG-compress an image so the resulting data URL fits chat sanitize budget.
 * Small images that already fit may keep original bytes when under budget.
 */
export async function compressImageForChat(
  file: File,
  options?: { maxDataUrlChars?: number },
): Promise<CompressImageResult> {
  const budget = options?.maxDataUrlChars ?? MAX_IMAGE_DATA_URL_CHARS;

  // Fast path: already small enough as-is
  const originalDataUrl = await blobToDataUrl(file);
  if (originalDataUrl.length <= budget) {
    return {
      dataUrl: originalDataUrl,
      mimeType: file.type || "image/png",
      size: file.size,
    };
  }

  if (typeof createImageBitmap !== "function") {
    throw new Error("当前环境无法压缩图片，请使用更小的图片后重试");
  }

  const bitmap = await createImageBitmap(file);
  try {
    const { width, height } = scaleSize(bitmap.width, bitmap.height, MAX_EDGE);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("无法创建画布以压缩图片");
    ctx.drawImage(bitmap, 0, 0, width, height);

    for (const quality of QUALITIES) {
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), "image/jpeg", quality);
      });
      if (!blob) continue;
      const dataUrl = await blobToDataUrl(blob);
      if (dataUrl.length <= budget) {
        return { dataUrl, mimeType: "image/jpeg", size: blob.size };
      }
    }

    throw new Error(
      `图片压缩后仍超过可嵌入上限（约 ${Math.round(budget / 1_000_000)}MB data URL），请缩小分辨率后重试`,
    );
  } finally {
    bitmap.close();
  }
}
