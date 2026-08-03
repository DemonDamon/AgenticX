import { describe, expect, it } from "vitest";
import {
  MAX_MINDMAP_NODES,
  buildMindmap,
  sanitizeMindmapNodeText,
} from "./report-mindmap";
import type { ReportOutline } from "./report-writer";

function outlineWith(n: number): ReportOutline {
  return {
    title: "T",
    sections: Array.from({ length: n }, (_, i) => ({
      id: `s${i + 1}`,
      title: `章节${i + 1}`,
      brief: "b",
      citationIndexes: [],
      format: "prose" as const,
    })),
  };
}

describe("sanitizeMindmapNodeText", () => {
  it("strips citations, parens, and newlines", () => {
    expect(sanitizeMindmapNodeText("标题[3]\n(补充)")).toBe("标题 补充");
  });
});

describe("buildMindmap", () => {
  it("starts with mindmap and includes root + sections", () => {
    const md = buildMindmap({
      topic: "DeepSeek V4",
      outline: {
        title: "报告",
        sections: [
          { id: "s1", title: "核心结论", brief: "b", citationIndexes: [], format: "prose" },
          { id: "s2", title: "技术路径", brief: "b", citationIndexes: [], format: "prose" },
        ],
      },
    });
    const lines = md.split("\n");
    expect(lines[0]).toBe("mindmap");
    expect(md).toContain("root((");
    expect(md).toContain("核心结论");
    expect(md).toContain("技术路径");
  });

  it("sanitizes unsafe title characters", () => {
    const md = buildMindmap({
      topic: "主题",
      outline: {
        title: "T",
        sections: [
          {
            id: "s1",
            title: "结论[3]\n(草案)",
            brief: "b",
            citationIndexes: [],
            format: "prose",
          },
        ],
      },
    });
    expect(md).toContain("结论 草案");
    expect(md).not.toContain("[3]");
    const sectionLine = md.split("\n").find((l) => l.includes("结论"));
    expect(sectionLine).toBeDefined();
    expect(sectionLine).not.toMatch(/[()[\]]/);
  });

  it("caps total nodes at MAX_MINDMAP_NODES while keeping all sections", () => {
    const sectionCount = 8;
    const outline = outlineWith(sectionCount);
    const points: Record<string, string[]> = {};
    for (const s of outline.sections) {
      points[s.id] = Array.from({ length: 10 }, (_, i) => `要点${i + 1}`);
    }
    const md = buildMindmap({
      topic: "主题",
      outline,
      sectionKeyPoints: points,
    });
    // root + sections + key points lines under mindmap
    const nodeLines = md
      .split("\n")
      .filter((line) => line.trim() && line.trim() !== "mindmap");
    expect(nodeLines.length).toBeLessThanOrEqual(MAX_MINDMAP_NODES);
    for (const s of outline.sections) {
      expect(md).toContain(s.title);
    }
  });

  it("returns empty string for empty outline", () => {
    expect(
      buildMindmap({
        topic: "主题",
        outline: { title: "T", sections: [] },
      }),
    ).toBe("");
  });
});
