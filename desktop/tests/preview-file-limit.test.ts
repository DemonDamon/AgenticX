import { describe, expect, it } from "vitest";
import {
  PREVIEW_LIMIT_DEFAULT_BYTES,
  PREVIEW_LIMIT_FLOOR_BYTES,
  PREVIEW_LIMIT_HIGH_BYTES,
  PREVIEW_LIMIT_MID_BYTES,
  previewLimitExceededMessage,
  previewMaxBytesForHost,
  previewMaxBytesForMemory,
} from "../electron/preview-file-limit";

const GiB = 1024 * 1024 * 1024;

describe("previewMaxBytesForMemory", () => {
  it("keeps the 25MB budget on a typical 8GB host with free headroom", () => {
    expect(
      previewMaxBytesForMemory({ totalBytes: 8 * GiB, freeBytes: 3 * GiB }),
    ).toBe(PREVIEW_LIMIT_DEFAULT_BYTES);
  });

  it("raises the cap on 16GB and 32GB hosts when memory is free", () => {
    expect(
      previewMaxBytesForMemory({ totalBytes: 16 * GiB, freeBytes: 8 * GiB }),
    ).toBe(PREVIEW_LIMIT_MID_BYTES);
    expect(
      previewMaxBytesForMemory({ totalBytes: 32 * GiB, freeBytes: 12 * GiB }),
    ).toBe(PREVIEW_LIMIT_HIGH_BYTES);
  });

  it("stays at the floor on a 4GB host", () => {
    expect(
      previewMaxBytesForMemory({ totalBytes: 4 * GiB, freeBytes: 1 * GiB }),
    ).toBe(PREVIEW_LIMIT_FLOOR_BYTES);
  });

  it("tightens toward the floor when free memory is scarce", () => {
    expect(
      previewMaxBytesForMemory({ totalBytes: 32 * GiB, freeBytes: 100 * 1024 * 1024 }),
    ).toBe(PREVIEW_LIMIT_FLOOR_BYTES);
  });
});

describe("previewMaxBytesForHost", () => {
  it("reads the injected snapshot instead of a hardcoded 25MB", () => {
    expect(
      previewMaxBytesForHost(() => ({ totalBytes: 32 * GiB, freeBytes: 16 * GiB })),
    ).toBe(PREVIEW_LIMIT_HIGH_BYTES);
  });
});

describe("previewLimitExceededMessage", () => {
  it("states the computed megabyte cap", () => {
    expect(previewLimitExceededMessage(PREVIEW_LIMIT_DEFAULT_BYTES)).toBe(
      "文件超过本机预览上限（25MB），可在系统应用中打开",
    );
  });
});
