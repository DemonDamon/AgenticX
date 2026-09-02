import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SessionChangeList } from "./SessionChangeList";

describe("SessionChangeList", () => {
  it("sums added/removed and keeps per-file marks", () => {
    const html = renderToStaticMarkup(
      <SessionChangeList
        rows={[
          { path: "/tmp/a.txt", added: 6, removed: 0 },
          { path: "/tmp/b.md", added: 2, removed: 1 },
        ]}
      />,
    );
    expect(html).toContain("文件变更");
    expect(html).toContain("+8");
    expect(html).toContain("-1");
    expect(html).toContain("a.txt");
    expect(html).toContain("b.md");
    expect(html).toContain('data-file-mark="txt"');
    expect(html).toContain('data-file-mark="md"');
  });

  it("gives language files distinct marks instead of a shared code glyph", () => {
    const html = renderToStaticMarkup(
      <SessionChangeList
        rows={[
          { path: "/tmp/hello.txt", added: 1, removed: 0 },
          { path: "/tmp/main.go", added: 2, removed: 0 },
          { path: "/tmp/main.py", added: 3, removed: 0 },
          { path: "/tmp/main.c", added: 1, removed: 0 },
          { path: "/tmp/npc_base.gd", added: 1, removed: 0 },
        ]}
      />,
    );
    expect(html).toContain('data-file-mark="txt"');
    expect(html).toContain('data-file-mark="go"');
    expect(html).toContain('data-file-mark="py"');
    expect(html).toContain('data-file-mark="c"');
    expect(html).toContain('data-file-mark="code"');
    expect(html).toContain("h-4 w-4");
  });
});
