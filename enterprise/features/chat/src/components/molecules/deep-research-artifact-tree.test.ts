import { describe, expect, it } from "vitest";
import {
  buildArtifactTree,
  collapseSingleFileDirs,
  displayNameForArtifactDir,
  displayNameForArtifactFile,
  displaySubtitleForCollapsedFile,
  formatArtifactByteSize,
  isHtmlArtifact,
  prepareHtmlPreviewSrcDoc,
  repairBrokenCitationHrefs,
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

  it("detects Word-HTML .doc by mimeType or .doc path", () => {
    expect(
      isHtmlArtifact({
        path: "research/r1/report.doc",
        mimeType: "application/vnd.ms-word",
      }),
    ).toBe(true);
    expect(isHtmlArtifact({ path: "research/r1/report.doc", mimeType: "text/plain" })).toBe(true);
  });
});

describe("prepareHtmlPreviewSrcDoc with Word-HTML .doc", () => {
  it("produces non-empty iframe srcDoc for Word-compatible HTML", () => {
    const wordHtml = `<html xmlns:w="urn:schemas-microsoft-com:office:word">
<head><title>t</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View></w:WordDocument></xml><![endif]-->
</head><body><p>验收正文</p></body></html>`;
    const out = prepareHtmlPreviewSrcDoc(wordHtml, false);
    expect(out.trim().length).toBeGreaterThan(0);
    expect(out).toContain("验收正文");
    expect(out).toContain("WordDocument");
  });
});

describe("prepareHtmlPreviewSrcDoc", () => {
  it("returns empty string for blank content (no white iframe shell)", () => {
    expect(prepareHtmlPreviewSrcDoc("", false)).toBe("");
    expect(prepareHtmlPreviewSrcDoc("   \n", true)).toBe("");
  });

  it("stamps dark class onto html for portal dark theme", () => {
    const out = prepareHtmlPreviewSrcDoc(
      '<!DOCTYPE html><html lang="zh"><head></head></html>',
      true,
    );
    expect(out).toMatch(/<html\b[^>]*\bclass="dark"[^>]*>/i);
    expect(out).toContain('lang="zh"');
  });

  it("appends dark to an existing class list without dropping other attrs", () => {
    const out = prepareHtmlPreviewSrcDoc('<html class="report" lang="zh">', true);
    expect(out).toContain('class="report dark"');
    expect(out).toContain('lang="zh"');
  });

  it("removes dark class for light theme", () => {
    const out = prepareHtmlPreviewSrcDoc('<html class="dark report">', false);
    expect(out).toContain('class="report"');
    expect(out).not.toMatch(/\bdark\b/);
  });

  it("injects narrow toc collapse patch for portal preview of saved html", () => {
    const out = prepareHtmlPreviewSrcDoc(
      "<!DOCTYPE html><html><head><title>t</title></head><body><div class=\"sidebar\"><h2>目录</h2><ul class=\"toc\"></ul></div></body></html>",
      false,
    );
    expect(out).toContain('id="agx-portal-toc-narrow"');
    expect(out).toContain("max-width: 520px");
    expect(out).toContain(".sidebar:not(.toc-open) .toc");
    expect(out).toContain('id="agx-portal-toc-narrow-js"');
    expect(out).toContain(".theme-toggle { display: none !important; }");
    expect(out).toContain("__agxPortalHashNav");
    expect(out).toContain("scrollToHash");
    const clickHandler = out.slice(
      out.indexOf("__agxPortalHashNav"),
      out.indexOf("</script>", out.indexOf("__agxPortalHashNav")),
    );
    expect(clickHandler.indexOf("preventDefault")).toBeLessThan(
      clickHandler.lastIndexOf("scrollToHash(href)"),
    );
  });

  it("repairs bare citation hrefs when ref targets exist", () => {
    const broken =
      '<p>见 <a href="#">3</a></p><li id="ref-3">来源</li>';
    expect(repairBrokenCitationHrefs(broken)).toContain('href="#ref-3"');
    const out = prepareHtmlPreviewSrcDoc(
      `<!DOCTYPE html><html><head></head><body>${broken}</body></html>`,
      false,
    );
    expect(out).toContain('href="#ref-3"');
    expect(out).not.toMatch(/<a href="#">3<\/a>/);
  });
});

describe("displayNameForArtifactDir", () => {
  it("localizes known research folders", () => {
    expect(displayNameForArtifactDir("lanes")).toBe("调研车道");
    expect(displayNameForArtifactDir("pages")).toBe("网页正文");
    expect(displayNameForArtifactDir("assets")).toBe("资源");
    expect(displayNameForArtifactDir("custom")).toBe("custom");
  });
});

describe("displaySubtitleForCollapsedFile", () => {
  it("uses Chinese kind labels instead of raw filenames", () => {
    expect(displaySubtitleForCollapsedFile("memo.md", 2048)).toBe("备忘 · 2.00 KB");
    expect(displaySubtitleForCollapsedFile("note.md", 512)).toBe("文档 · 512 B");
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

    // Primary report first (human title), then localized lanes folder.
    expect(tree.map((n) => n.name)).toEqual(["终稿.md", "调研车道"]);
    const lanes = tree[1]!;
    expect(lanes.type).toBe("dir");
    if (lanes.type !== "dir") return;
    expect(lanes.byteSize).toBe(500);
    expect(lanes.fileCount).toBe(2);
    // q1/memo.md collapsed into a file row titled with the lane folder name
    expect(lanes.children.map((c) => c.type)).toEqual(["file", "file"]);
    expect(lanes.children.map((c) => c.name)).toEqual(["q1-pricing", "q2-benchmark"]);
    expect(lanes.children.map((c) => (c.type === "file" ? c.subtitle : ""))).toEqual([
      "备忘 · 200 B",
      "备忘 · 300 B",
    ]);
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
