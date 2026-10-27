import { describe, expect, it } from "vitest";

import { diffLines, diffManifests, stableStringify } from "../manifest-diff";

describe("manifest diff", () => {
  it("stableStringify sorts keys recursively", () => {
    expect(stableStringify({ b: 1, a: { d: 1, c: [2, 1] } })).toBe(
      JSON.stringify({ a: { c: [2, 1], d: 1 }, b: 1 }, null, 2),
    );
  });

  it("diffLines marks added and removed lines", () => {
    const lines = diffLines("a\nb", "a\nc");
    expect(lines.map((line) => line.kind)).toEqual(["same", "del", "add"]);
    expect(lines[1]).toMatchObject({ kind: "del", text: "b", oldNo: 2, newNo: null });
    expect(lines[2]).toMatchObject({ kind: "add", text: "c", oldNo: null, newNo: 2 });
  });

  it("identical manifests produce only same lines", () => {
    const manifest = { b: 1, a: "x" };
    const lines = diffManifests(manifest, { a: "x", b: 1 });
    expect(lines.every((line) => line.kind === "same")).toBe(true);
    expect(lines.some((line) => line.kind === "add" || line.kind === "del")).toBe(false);
  });

  it("falls back to full replace for huge inputs", () => {
    const oldText = Array.from({ length: 2100 }, (_, index) => `old-${index}`).join("\n");
    const newText = Array.from({ length: 2100 }, (_, index) => `new-${index}`).join("\n");
    const lines = diffLines(oldText, newText);
    expect(lines.every((line) => line.kind === "del" || line.kind === "add")).toBe(true);
    expect(lines.filter((line) => line.kind === "del")).toHaveLength(2100);
    expect(lines.filter((line) => line.kind === "add")).toHaveLength(2100);
  });
});
