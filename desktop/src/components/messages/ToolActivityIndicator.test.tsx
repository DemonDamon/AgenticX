import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Message } from "../../store";
import { useAppStore } from "../../store";
import { groupConsecutiveToolMessages } from "./group-tool-messages";
import { TurnToolGroupCard } from "./TurnToolGroupCard";
import {
  resolveToolActivityPresentation,
  resolveToolActivityLabel,
  resolveToolActivitySummary,
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
    expect(
      shouldPreserveToolDetails({
        ...toolMessage("running"),
        toolName: "bash_bg_start",
        content: "job_id=ordinary\nstatus=running\nauth_urls:\n(none)",
      }),
    ).toBe(false);
    expect(
      shouldPreserveToolDetails({
        ...toolMessage("running"),
        toolName: "bash_bg_start",
        content: "job_id=auth\nstatus=running\nauth_urls:\n- https://open.feishu.cn/page/cli?code=1",
      }),
    ).toBe(true);
    expect(shouldPreserveToolDetails(toolMessage("running"))).toBe(false);
  });

  it("shows expandable non-technical summaries for running, completed, and failed work", () => {
    useAppStore.setState({ showToolCalls: false });
    const runningHtml = renderToStaticMarkup(
      <TurnToolGroupCard messages={[toolMessage("running")]} />,
    );
    expect(runningHtml).toContain("正在查找资料");
    expect(runningHtml).not.toContain("web_search");

    const doneHtml = renderToStaticMarkup(
      <TurnToolGroupCard messages={[toolMessage("done")]} />,
    );
    expect(doneHtml).toContain("已完成 1 个步骤");
    expect(doneHtml).not.toContain("web_search");
    expect(doneHtml).not.toContain("technical result");

    const errorHtml = renderToStaticMarkup(
      <TurnToolGroupCard messages={[toolMessage("error")]} />,
    );
    expect(errorHtml).toContain("1 个步骤执行失败");
    expect(errorHtml).not.toContain("technical result");
  });

  it("uses the developer switch to restore details", () => {
    expect(resolveToolActivityPresentation(false, true)).toBe("summary");
    expect(resolveToolActivityPresentation(false, false)).toBe("summary");
    expect(resolveToolActivityPresentation(true, false)).toBe("details");

    useAppStore.getState().setShowToolCalls(true);
    expect(useAppStore.getState().showToolCalls).toBe(true);
  });

  it("does not hide an earlier failure while a later step is still running", () => {
    const summary = resolveToolActivitySummary([
      toolMessage("error"),
      { ...toolMessage("running"), id: "tool-2", toolCallId: "call-2" },
    ]);
    expect(summary.active).toBe(true);
    expect(summary.tone).toBe("error");
    expect(summary.label).toContain("1 个步骤失败");
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

  it("groups ordinary background jobs but leaves authorization links visible", () => {
    const ordinary = {
      ...toolMessage("running"),
      id: "tool-background",
      toolCallId: "call-background",
      toolName: "bash_bg_start",
      content: "job_id=ordinary\nstatus=running\nauth_urls:\n(none)",
    };
    const auth = {
      ...toolMessage("running"),
      id: "tool-auth",
      toolCallId: "call-auth",
      toolName: "bash_bg_start",
      content: "job_id=auth\nstatus=running\nauth_urls:\n- https://open.feishu.cn/page/cli?code=1",
    };

    expect(groupConsecutiveToolMessages([ordinary, auth]).map((row) => row.kind))
      .toEqual(["tool_group", "message"]);
  });
});
