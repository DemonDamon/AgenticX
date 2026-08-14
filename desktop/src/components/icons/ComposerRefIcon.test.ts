import { describe, expect, it } from "vitest";
import {
  composerRefIconInnerHtml,
  resolveComposerRefIconKind,
} from "./ComposerRefIcon";

describe("resolveComposerRefIconKind", () => {
  it("maps common file types and folders", () => {
    expect(resolveComposerRefIconKind("blog.md")).toBe("document");
    expect(resolveComposerRefIconKind("notes.mdx")).toBe("document");
    expect(resolveComposerRefIconKind("server.py")).toBe("code");
    expect(resolveComposerRefIconKind("wordmark.svg")).toBe("image");
    expect(resolveComposerRefIconKind("invoice.pdf")).toBe("pdf");
    expect(resolveComposerRefIconKind("readme.log")).toBe("file");
    expect(resolveComposerRefIconKind("AgenticX")).toBe("folder");
    expect(resolveComposerRefIconKind("src/utils")).toBe("file");
    expect(
      resolveComposerRefIconKind("desktop", { name: "@dir:desktop:/tmp/desktop", composerRefLabel: "desktop" })
    ).toBe("folder");
  });

  it("prefers HTML element chips over the filename", () => {
    expect(
      resolveComposerRefIconKind("index.html", {
        htmlElementRef: { tagName: "section", selectorHint: "section" },
      })
    ).toBe("element");
  });
});

describe("composerRefIconInnerHtml", () => {
  it("stamps a tone so CSS can color the glyph", () => {
    const html = composerRefIconInnerHtml("pdf", 13);
    expect(html).toContain('data-tone="pdf"');
    expect(html).toContain("viewBox");
  });
});
