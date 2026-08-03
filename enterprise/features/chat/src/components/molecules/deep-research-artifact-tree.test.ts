import { describe, expect, it } from "vitest";
import {
  buildArtifactTree,
  collapseSingleFileDirs,
  displayNameForArtifactFile,
  formatArtifactByteSize,
  isHtmlArtifact,
} from "./deep-research-artifact-tree";

describe("isHtmlArtifact", () => {
  it("detects html by mimeType or .html path", () => {
    expect(isHtmlArtifact({ path: "research/r1/report.html", mimeType: "text/html" })).toBe(true);
    expect(isHtmlArtifact({ path: "research/r1/report.html", mimeType: "text/plain" })).toBe(true);
    expect(isHtmlArtifact({ path: "research/r1/final-report.md", mimeType: "text/markdown" })).toBe(
      false,
    );
    expect(isHtmlArtifact(null)).toBe(false);
  });
});

describe("displayNameForArtifactFile", () => {
  it("uses title for pages/ and legacy hex names", () => {
    expect(
      displayNameForArtifactFile("a1b2c3d4e5f60789.md", {
        path: "research/r1/pages/a1b2c3d4e5f60789.md",
        title: "DeepSeek V4 技术解读",
      }),
    ).toBe("DeepSeek V4 技术解读.md");
    expect(
      displayNameForArtifactFile("DeepSeek-V4_a1b2c3d4e5f60789.md", {
        path: "research/r1/pages/DeepSeek-V4_a1b2c3d4e5f60789.md",
        title: "DeepSeek V4 技术解读",
      }),
    ).toBe("DeepSeek V4 技术解读.md");
  });

  it("uses human titles for primary report deliverables", () => {
    expect(
      displayNameForArtifactFile("final-report.md", {
        path: "research/r1/final-report.md",
        title: "MiniMax H3 核心技术点.md",
      }),
    ).toBe("MiniMax H3 核心技术点.md");
    expect(
      displayNameForArtifactFile("report.html", {
        path: "research/r1/report.html",
        title: "MiniMax H3 核心技术点.html",
      }),
    ).toBe("MiniMax H3 核心技术点.html");
  });
});

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

    // Primary report first (human title), then lanes folder.
    expect(tree.map((n) => n.name)).toEqual(["终稿.md", "lanes"]);
    const lanes = tree[1]!;
    expect(lanes.type).toBe("dir");
    if (lanes.type !== "dir") return;
    expect(lanes.byteSize).toBe(500);
    expect(lanes.fileCount).toBe(2);
    // q1/memo.md collapsed into a file row titled with the lane folder name
    expect(lanes.children.map((c) => c.type)).toEqual(["file", "file"]);
    expect(lanes.children.map((c) => c.name)).toEqual(["q1-pricing", "q2-benchmark"]);
  });

  it("lists report.html ahead of final-report.md", () => {
    const tree = buildArtifactTree([
      {
        id: "md",
        path: "research/r1/final-report.md",
        title: "主题.md",
        kind: "report",
        byteSize: 1000,
      },
      {
        id: "html",
        path: "research/r1/report.html",
        title: "主题.html",
        kind: "report",
        byteSize: 2000,
      },
    ]);
    expect(tree.map((n) => n.name)).toEqual(["主题.html", "主题.md"]);
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
