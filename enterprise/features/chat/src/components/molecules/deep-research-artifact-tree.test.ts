import { describe, expect, it } from "vitest";
import {
  buildArtifactTree,
  collapseSingleFileDirs,
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
  it("strips shared prefix, groups folders, and collapses single-file lane dirs", () => {
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
        path: "research/r1/lanes/q1-pricing/memo.md",
        title: "备忘",
        kind: "memo",
        byteSize: 200,
      },
      {
        id: "3",
        path: "research/r1/lanes/q2-benchmark/memo.md",
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
    expect(lanes.fileCount).toBe(2);
    // q1/memo.md collapsed into a file row titled with the lane folder name
    expect(lanes.children.map((c) => c.type)).toEqual(["file", "file"]);
    expect(lanes.children.map((c) => c.name)).toEqual(["q1-pricing", "q2-benchmark"]);
  });
});

describe("collapseSingleFileDirs", () => {
  it("keeps multi-child dirs intact", () => {
    const nodes = collapseSingleFileDirs([
      {
        type: "dir",
        key: "assets",
        name: "assets",
        byteSize: 10,
        fileCount: 2,
        children: [
          {
            type: "file",
            key: "assets/a.md",
            name: "a.md",
            artifact: {
              id: "a",
              path: "assets/a.md",
              title: "a",
              kind: "other",
              byteSize: 4,
            },
          },
          {
            type: "file",
            key: "assets/b.md",
            name: "b.md",
            artifact: {
              id: "b",
              path: "assets/b.md",
              title: "b",
              kind: "other",
              byteSize: 6,
            },
          },
        ],
      },
    ]);
    expect(nodes[0]?.type).toBe("dir");
    if (nodes[0]?.type !== "dir") return;
    expect(nodes[0].children).toHaveLength(2);
  });
});
