import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TurnArtifactCard } from "./TurnArtifactCard";

describe("TurnArtifactCard deliverable grid", () => {
  it("renders one artifact as a single card with a typed glyph", () => {
    const html = renderToStaticMarkup(
      <TurnArtifactCard paths={["/tmp/hello.txt"]} onOpenPath={() => undefined} />,
    );

    expect(html).toContain("hello.txt");
    expect(html).toContain('data-file-mark="txt"');
    expect(html).toContain("--theme-color-rgb");
    expect(html).toContain('aria-label="预览 hello.txt"');
    expect(html).toContain('aria-label="另存为 hello.txt"');
    expect(html).toContain('aria-label="复制路径 hello.txt"');
    expect(html).toContain('aria-label="在访达中显示 hello.txt"');
    expect(html).toContain("h-8 w-8");
    expect(html).toContain("color-mix(in_srgb,var(--text-primary)_10%,transparent)");
    expect(html).not.toContain("更多操作");
    expect(html).not.toContain("border-border/50");
    expect(html).not.toContain("本轮产物");
  });

  it("keeps md and sheet marks distinct while sharing the accent swatch", () => {
    const html = renderToStaticMarkup(
      <TurnArtifactCard
        paths={["/tmp/report.md", "/tmp/data.csv"]}
        onOpenPath={() => undefined}
      />,
    );

    expect(html).toContain("report.md");
    expect(html).toContain("data.csv");
    // Both fit the grid, so no expander is needed.
    expect(html).not.toContain("查看全部");
    expect(html).toContain('data-file-mark="md"');
    expect(html).toContain('data-file-mark="sheet"');
    expect(html).toContain("--theme-color-rgb");
  });

  it("collapses past four files behind one expander", () => {
    const html = renderToStaticMarkup(
      <TurnArtifactCard
        paths={[
          "/tmp/a.md",
          "/tmp/b.gd",
          "/tmp/c.tscn",
          "/tmp/d.json",
          "/tmp/e.txt",
        ]}
        onOpenPath={() => undefined}
      />,
    );

    expect(html).toContain("查看全部 5 个产物");
    expect(html).not.toContain("e.txt");
  });
});
