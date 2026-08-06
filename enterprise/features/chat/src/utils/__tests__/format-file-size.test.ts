import { describe, expect, it } from "vitest";
import { formatFileSize } from "../format-file-size";

describe("formatFileSize", () => {
  it("formats megabytes with two decimals", () => {
    expect(formatFileSize(15_925_248)).toBe("15.19 MB");
  });

  it("returns empty for missing or non-positive sizes", () => {
    expect(formatFileSize(0)).toBe("");
    expect(formatFileSize(undefined)).toBe("");
    expect(formatFileSize(Number.NaN)).toBe("");
  });

  it("formats bytes and kilobytes", () => {
    expect(formatFileSize(512)).toBe("512 B");
    expect(formatFileSize(2048)).toBe("2.00 KB");
  });
});
