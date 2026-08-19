import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Message } from "../../store";
import { useAppStore } from "../../store";
import { ReactWorkCollapse } from "./ReactWorkCollapse";

function MessageProbe({ message }: { message: Message }) {
  return <span>{message.content}</span>;
}

afterEach(() => {
  useAppStore.setState({ showToolCalls: false });
});

describe("ReactWorkCollapse", () => {
  it("collapses a process into one activity summary when details are disabled", () => {
    useAppStore.setState({ showToolCalls: false });
    const html = renderToStaticMarkup(
      <ReactWorkCollapse toolCount={2} active={false}>
        <span>implementation narration</span>
      </ReactWorkCollapse>,
    );

    expect(html).toContain("已完成 2 个步骤");
    expect(html).not.toContain("implementation narration");
  });

  it("never collapses errors or required user decisions", () => {
    const errorMessage: Message = {
      id: "tool-error",
      role: "tool",
      content: "visible failure",
      toolCallId: "call-error",
      toolName: "bash_exec",
      toolStatus: "error",
    };
    const confirmMessage: Message = {
      id: "tool-confirm",
      role: "tool",
      content: "visible confirmation",
      toolCallId: "call-confirm",
      toolName: "file_write",
      toolStatus: "running",
      inlineConfirm: {
        requestId: "confirm-1",
        question: "继续？",
        agentId: "meta",
        sessionId: "session-1",
      },
    };

    const errorHtml = renderToStaticMarkup(
      <ReactWorkCollapse toolCount={1} active={false}>
        <MessageProbe message={errorMessage} />
      </ReactWorkCollapse>,
    );
    const confirmHtml = renderToStaticMarkup(
      <ReactWorkCollapse toolCount={1} active>
        <MessageProbe message={confirmMessage} />
      </ReactWorkCollapse>,
    );

    expect(errorHtml).toContain("visible failure");
    expect(confirmHtml).toContain("visible confirmation");
  });

  it("keeps the existing low-volume view when technical details are enabled", () => {
    useAppStore.setState({ showToolCalls: true });
    const html = renderToStaticMarkup(
      <ReactWorkCollapse toolCount={1} active={false}>
        <span>technical child</span>
      </ReactWorkCollapse>,
    );

    expect(html).toContain("technical child");
    expect(html).not.toContain("已思考并调用");
  });
});
