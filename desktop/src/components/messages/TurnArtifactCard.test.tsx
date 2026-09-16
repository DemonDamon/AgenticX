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
    expect(html).toContain('aria-label="预览 hello.txt"');
    expect(html).toContain('aria-label="另存为 hello.txt"');
    expect(html).toContain('aria-label="复制路径 hello.txt"');
    expect(html).toContain('aria-label="在访达中显示 hello.txt"');
    expect(html).toContain("h-5 w-5");
    expect(html).toContain("agx-artifact-cq");
    expect(html).toContain("agx-artifact-grid--single");
    expect(html).not.toContain("agx-artifact-grid--multi");
    expect(html).toContain("w-max max-w-full");
    expect(html).not.toContain("justify-between");
    expect(html).toContain("color-mix(in_srgb,var(--text-primary)_10%,transparent)");
    expect(html).not.toContain("更多操作");
    expect(html).not.toContain("border-border/50");
    expect(html).not.toContain("本轮产物");
  });

  it("keeps md and sheet marks distinct", () => {
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
    expect(html).toContain("#8BB6EE");
    expect(html).toContain("#1E3F70");
    expect(html).not.toContain("#C9843A");
    expect(html).toContain("M2.95 1.85h8.55");
    expect(html).not.toContain("M3.15 1.55h7.15L12.95 4.2");
    expect(html).toContain("agx-artifact-grid--multi");
    expect(html).toContain("justify-between");
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

  it("opens the workbench via 查看所有产物 / 变更 instead of an in-place expander", () => {
    const html = renderToStaticMarkup(
      <TurnArtifactCard
        paths={["/tmp/a.txt", "/tmp/b.txt", "/tmp/c.txt"]}
        onOpenPath={() => undefined}
        onOpenAllArtifacts={() => undefined}
        onOpenAllChanges={() => undefined}
        changeCount={3}
      />,
    );
    expect(html).toContain("查看所有产物 (3)");
    expect(html).toContain("查看所有变更 (3)");
    expect(html).toContain("flex-wrap items-center");
    expect(html).not.toContain("flex-col items-start");
    expect(html).not.toContain("查看全部");
  });

  it("shows session-wide 查看所有 counts even when this turn only has one file", () => {
    const html = renderToStaticMarkup(
      <TurnArtifactCard
        paths={["/tmp/c.txt"]}
        onOpenPath={() => undefined}
        onOpenAllArtifacts={() => undefined}
        onOpenAllChanges={() => undefined}
        artifactCount={3}
        changeCount={3}
      />,
    );
    expect(html).toContain("c.txt");
    expect(html).toContain("agx-artifact-grid--single");
    expect(html).not.toContain("a.txt");
    expect(html).toContain("查看所有产物 (3)");
    expect(html).toContain("查看所有变更 (3)");
    expect(html).not.toContain("查看所有产物 (1)");
    expect(html).not.toContain("查看所有变更 (1)");
  });
});
