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
});
