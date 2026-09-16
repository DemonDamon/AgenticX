import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vitest";
import {
  chatMarkdownComponents,
  chatUrlTransform,
  MarkdownContext,
} from "./markdown-components";

function renderPathCode(path: string, handoffPaths: string[]) {
  return renderToStaticMarkup(
    <MarkdownContext.Provider value={{ onRevealPath: () => undefined, handoffPaths }}>
      <ReactMarkdown components={chatMarkdownComponents} urlTransform={chatUrlTransform}>
        {`路径：\`${path}\``}
      </ReactMarkdown>
    </MarkdownContext.Provider>,
  );
}

describe("handoff inline path collapse", () => {
  it("renders a matching absolute path as the filename only", () => {
    const html = renderPathCode(
      "/Users/damon/.agenticx/taskspaces/abc/default/hello.txt",
      ["/Users/damon/.agenticx/taskspaces/abc/default/hello.txt"],
    );
    expect(html).toContain(">hello.txt<");
    expect(html).toContain("font-medium text-text-strong");
    expect(html).not.toContain("bg-surface-card");
  });

  it("keeps the full path pill when the file is not a turn handoff", () => {
    const html = renderPathCode("/tmp/notes.txt", ["/tmp/other.txt"]);
    expect(html).toContain("/tmp/notes.txt");
    expect(html).toContain("bg-surface-card");
  });

  it("makes a backtick path with spaces a clickable filename", () => {
    const path =
      "/Users/damon/.agenticx/taskspaces/c0683c71-0460-48cc-b681-a3b6509ec18d/default/Hello World第三方技能点.txt";
    const html = renderPathCode(path, [path]);
    expect(html).toContain("<button");
    expect(html).toContain(">Hello World第三方技能点.txt<");
    expect(html).toContain(`title="${path}"`);
    expect(html).not.toMatch(/<code[^>]*>Hello World第三方技能点\.txt<\/code>/);
  });

  it("collapses the session default workspace root instead of the UUID path", () => {
    const root =
      "/Users/damon/.agenticx/taskspaces/c0683c71-0460-48cc-b681-a3b6509ec18d/default/";
    const html = renderPathCode(root, [`${root}a.txt`]);
    expect(html).toContain(">当前工作区<");
    expect(html).not.toMatch(/>[^<]*c0683c71-0460-48cc-b681-a3b6509ec18d[^<]*</);
    expect(html).toContain('title="/Users/damon/.agenticx/taskspaces/c0683c71-0460-48cc-b681-a3b6509ec18d/default/"');
    expect(html).toContain("font-medium text-text-strong");
    expect(html).not.toContain("bg-surface-card");
  });
});
