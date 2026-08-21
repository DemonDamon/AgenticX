import { afterEach, describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Message } from "../../store";
import { useAppStore } from "../../store";
import { groupConsecutiveToolMessages } from "./group-tool-messages";
import { TurnToolGroupCard } from "./TurnToolGroupCard";
import { buildToolCardTitle } from "./ToolCallCard";
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

  it("keeps an answered clarification visible after its card metadata is gone", () => {
    // 落盘的澄清行只剩 tool_name + tool_args + "用户选择：…"，clarificationPrompt 是前端
    // 直播时从 tool_args 拼出来的，重开会话就没了。按工具名判定，答案才不会跟着一起消失。
    expect(
      shouldPreserveToolDetails({
        ...toolMessage("done"),
        toolName: "request_clarification",
        clarificationPrompt: undefined,
        content: "用户选择：你说的「清空磁盘」具体是指什么？：你能格式化我的磁盘吗？",
      }),
    ).toBe(true);
    expect(
      shouldPreserveToolDetails({
        ...toolMessage("done"),
        toolName: "request_action_confirmation",
        actionConfirmation: undefined,
        content: "用户选择：确认执行",
      }),
    ).toBe(true);
  });

  it("titles an answered clarification with the answer, not the tool name", () => {
    // 收起状态下标题是用户唯一能看到的一行，写 "request_clarification" 等于把选择藏了。
    expect(
      buildToolCardTitle({
        id: "clr",
        role: "tool",
        content: "用户选择：清理缓存和临时文件，释放磁盘空间",
        toolName: "request_clarification",
      } as Message),
      // 标题要短：后端那句 "用户选择：" 压成 "已选："，剩下的留给内容本身。
      // 完整的九种形态在 tool-call-card-title.test.ts 里逐条钉住。
    ).toBe("已选：清理缓存和临时文件，释放磁盘空间");
    expect(
      buildToolCardTitle({
        id: "clr2",
        role: "tool",
        content: "",
        toolName: "request_clarification",
      } as Message),
    ).toBe("等待你补充信息");
  });

  it("does not fold a standalone clarification row into a tool group", () => {
    const clarification: Message = {
      id: "clr-1",
      role: "tool",
      content: "用户选择：清理缓存和临时文件",
      toolCallId: "call-clr",
      toolName: "request_clarification",
      toolStatus: "done",
    };
    const rows = groupConsecutiveToolMessages([toolMessage("done"), clarification]);
    const standalone = rows.filter((r) => r.kind === "message");
    expect(standalone).toHaveLength(1);
    expect(standalone[0].kind === "message" && standalone[0].message.id).toBe("clr-1");
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
