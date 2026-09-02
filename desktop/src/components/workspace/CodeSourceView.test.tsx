import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CodeSourceView } from "./CodeSourceView";

const GO = `package main

func main() {
    fmt.Println("Hello World")
}
`;

describe("CodeSourceView", () => {
  it("renders line numbers, fold controls, and added-line marks", () => {
    const html = renderToStaticMarkup(
      <CodeSourceView content={GO} path="/tmp/main.go" addedLines={[3, 4]} />,
    );
    expect(html).toContain("agx-code-source");
    expect(html).toContain('data-preview-line="1"');
    expect(html).toContain('data-preview-line="3"');
    expect(html).toContain("agx-code-lineno");
    expect(html).toContain("折叠此范围");
    expect(html).toContain("agx-code-line--added");
  });

  it("does not draw an indent guide on the closing brace line", () => {
    const html = renderToStaticMarkup(
      <CodeSourceView content={GO} path="/tmp/main.go" />,
    );
    const closer = html.match(/data-preview-line="5"[\s\S]*?<\/div>/)?.[0] ?? "";
    const body = html.match(/data-preview-line="4"[\s\S]*?<\/div>/)?.[0] ?? "";
    expect(body).toContain("agx-code-indent");
    expect(closer).not.toContain("agx-code-indent");
  });
});
