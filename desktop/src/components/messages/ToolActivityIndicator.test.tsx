import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Message } from "../../store";
import { useAppStore } from "../../store";
import { groupConsecutiveToolMessages } from "./group-tool-messages";
import { TurnToolGroupCard } from "./TurnToolGroupCard";
import {
  resolveToolActivityPresentation,
  resolveToolActivityLabel,
  shouldPreserveToolDetails,
} from "./ToolActivityIndicator";

function toolMessage(status: Message["toolStatus"]): Message {
  return {
    id: "tool-1",
    role: "tool",
    content: "technical result",
    toolCallId: "call-1",
    toolName: "web_search",
    toolStatus: status,
    toolElapsedSec: 3,
  };
}

afterEach(() => {
  useAppStore.setState({ showToolCalls: false });
});

describe("customer-facing tool activity", () => {
  it("maps implementation names to user-facing work phases", () => {
    expect(resolveToolActivityLabel("web_search")).toBe("正在查找资料");
    expect(resolveToolActivityLabel("file_write")).toBe("正在整理内容");
    expect(resolveToolActivityLabel("bash_exec")).toBe("正在执行任务");
    expect(resolveToolActivityLabel("delegate_to_avatar")).toBe("正在协调任务");
    expect(resolveToolActivityLabel("unknown_tool")).toBe("正在处理");
  });

  it("keeps user decisions visible when details are hidden", () => {
    expect(
      shouldPreserveToolDetails({
        ...toolMessage("running"),
        inlineConfirm: {
          requestId: "r",
          question: "继续？",
          agentId: "meta",
          sessionId: "session-1",
        },
      }),
    ).toBe(true);
    expect(shouldPreserveToolDetails({ ...toolMessage("running"), toolName: "skill_manage" })).toBe(true);
    expect(shouldPreserveToolDetails(toolMessage("running"))).toBe(false);
  });

  it("shows generic live progress and removes completed technical traces by default", () => {
    useAppStore.setState({ showToolCalls: false });
    const runningHtml = renderToStaticMarkup(
      <TurnToolGroupCard messages={[toolMessage("running")]} />,
    );
    expect(runningHtml).toContain("正在查找资料");
    expect(runningHtml).not.toContain("web_search");
    expect(
      renderToStaticMarkup(<TurnToolGroupCard messages={[toolMessage("done")]} />),
    ).toBe("");
  });

  it("uses the developer switch to restore details", () => {
    expect(resolveToolActivityPresentation(false, true)).toBe("activity");
    expect(resolveToolActivityPresentation(false, false)).toBe("hidden");
    expect(resolveToolActivityPresentation(true, false)).toBe("details");

    useAppStore.getState().setShowToolCalls(true);
    expect(useAppStore.getState().showToolCalls).toBe(true);
  });

  it("keeps required interaction and safety rows outside technical groups", () => {
    const normal = toolMessage("done");
    const confirmation: Message = {
      ...toolMessage("running"),
      id: "tool-confirm",
      toolCallId: "call-confirm",
      inlineConfirm: {
        requestId: "confirm-1",
        question: "继续？",
        agentId: "meta",
        sessionId: "session-1",
      },
    };
    const blocked: Message = {
      ...toolMessage("error"),
      id: "tool-blocked",
      toolCallId: "call-blocked",
      content: "工具调用被 Hook 策略阻止。",
    };

    expect(groupConsecutiveToolMessages([normal, confirmation, blocked]).map((row) => row.kind))
      .toEqual(["tool_group", "message", "message"]);
  });
});
