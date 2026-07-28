import { describe, expect, it } from "vitest";
import {
  buildArtifactTree,
  formatArtifactByteSize,
} from "./deep-research-artifact-tree";

describe("formatArtifactByteSize", () => {
  it("formats B / KB / MB", () => {
    expect(formatArtifactByteSize(512)).toBe("512 B");
    expect(formatArtifactByteSize(26500)).toBe("25.88 KB");
    expect(formatArtifactByteSize(128 * 1024)).toBe("128 KB");
  });
});

describe("buildArtifactTree", () => {
  it("strips shared research/<runId>/ prefix and groups folders", () => {
    const tree = buildArtifactTree([
      {
        id: "1",
        path: "research/r1/final-report.md",
        title: "终稿",
        kind: "report",
        byteSize: 1000,
      },
      {
        id: "2",
        path: "research/r1/lanes/a/memo.md",
        title: "备忘",
        kind: "memo",
        byteSize: 200,
      },
      {
        id: "3",
        path: "research/r1/lanes/b/memo.md",
        title: "备忘2",
        kind: "memo",
        byteSize: 300,
      },
    ]);

    expect(tree.map((n) => n.name)).toEqual(["lanes", "final-report.md"]);
    const lanes = tree[0]!;
    expect(lanes.type).toBe("dir");
    if (lanes.type !== "dir") return;
    expect(lanes.byteSize).toBe(500);
    expect(lanes.children).toHaveLength(2);
    expect(lanes.children.every((c) => c.type === "dir")).toBe(true);
  });
});
