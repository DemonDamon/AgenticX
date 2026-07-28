import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { compressImageForChat } from "./compress-image";

function makeFile(bytes: number, type = "image/png", name = "big.png"): File {
  const buf = new Uint8Array(bytes);
  buf.fill(7);
  return new File([buf], name, { type });
}

describe("compressImageForChat", () => {
  const originalCreateImageBitmap = globalThis.createImageBitmap;
  const originalDocument = globalThis.document;

  beforeEach(() => {
    // FileReader polyfill for Node vitest
    class FR {
      result: string | ArrayBuffer | null = null;
      onload: null | (() => void) = null;
      onerror: null | (() => void) = null;
      readAsDataURL(blob: Blob) {
        void blob.arrayBuffer().then((ab) => {
          const b64 = Buffer.from(ab).toString("base64");
          this.result = `data:image/jpeg;base64,${b64}`;
          this.onload?.();
        });
      }
    }
    // @ts-expect-error test polyfill
    globalThis.FileReader = FR;
  });

  afterEach(() => {
    globalThis.createImageBitmap = originalCreateImageBitmap;
    globalThis.document = originalDocument;
    vi.restoreAllMocks();
  });

  it("returns original data URL when already under budget", async () => {
    const file = makeFile(32);
    const result = await compressImageForChat(file, { maxDataUrlChars: 10_000_000 });
    expect(result.dataUrl.startsWith("data:")).toBe(true);
    expect(result.size).toBe(32);
  });

  it("compresses via canvas until under budget", async () => {
    const file = makeFile(200);
    // Force "over budget" on original by tiny budget that original can't meet,
    // then canvas path returns small jpeg.
    globalThis.createImageBitmap = vi.fn().mockResolvedValue({
      width: 4000,
      height: 3000,
      close: vi.fn(),
    }) as unknown as typeof createImageBitmap;

    const toBlob = vi.fn((cb: (b: Blob | null) => void, _type?: string, quality?: number) => {
      const n = quality && quality <= 0.55 ? 40 : 5000;
      cb(new Blob([new Uint8Array(n)], { type: "image/jpeg" }));
    });

    globalThis.document = {
      createElement: vi.fn().mockReturnValue({
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: vi.fn() }),
        toBlob,
      }),
    } as unknown as Document;

    const result = await compressImageForChat(file, { maxDataUrlChars: 200 });
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.dataUrl.length).toBeLessThanOrEqual(200);
    expect(toBlob.mock.calls.length).toBeGreaterThan(0);
  });
});
