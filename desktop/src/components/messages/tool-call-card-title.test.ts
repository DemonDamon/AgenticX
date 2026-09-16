import { describe, expect, it } from "vitest";
import type { Message } from "../../store";
import { buildToolCardTitle, summarizeUserDecision } from "./ToolCallCard";

function toolMessage(overrides?: Partial<Message>): Message {
  return {
    id: "m1",
    role: "assistant",
    content: "tool call",
    toolName: "video_understand",
    toolArgs: { path: "/x/y/a.mp4" },
    ...overrides,
  };
}

describe("buildToolCardTitle", () => {
  it("renders friendly title for video_understand with file name", () => {
    expect(buildToolCardTitle(toolMessage())).toBe("理解视频 a.mp4");
  });

  it("falls back when path is missing", () => {
    expect(buildToolCardTitle(toolMessage({ toolArgs: {} }))).toBe("理解视频");
  });
});


// 后端一共产出九种结果串（agenticx/cli/agent_tools.py 的
// build_clarification_tool_result / build_action_confirmation_tool_result）。
// 每一种都得钉住：之前只认「用户选择：」，另外八种全掉进 fallback，
// 卡片对已经答完的问题一直显示「等待你确认」。
describe("summarizeUserDecision", () => {
  const confirm = (raw: string) => summarizeUserDecision("request_action_confirmation", raw);
  const clarify = (raw: string) => summarizeUserDecision("request_clarification", raw);

  it("summarizes every action-confirmation shape", () => {
    expect(confirm("[ACTION_CONFIRMED] 用户已确认执行。")).toBe("已确认执行");
    expect(confirm("[ACTION_REJECTED] 用户已取消执行。不得继续该动作。")).toBe("已取消");
    expect(confirm("[ACTION_REJECTED] 用户未明确确认。不得继续该动作。")).toBe("未明确确认，已取消");
    expect(confirm("[ACTION_CONFIRMATION_EXPIRED] 确认已失效。")).toBe("确认已失效");
    expect(confirm("[ACTION_CONFIRMATION_SUSPENDED] 无人值守会话不能确认外部写操作。")).toBe(
      "无人值守，未确认",
    );
  });

  it("summarizes every clarification shape", () => {
    expect(clarify("用户选择：方案 A；方案 B。")).toBe("已选：方案 A；方案 B");
    expect(clarify("自定义补充：先跑一遍测试。")).toBe("已补充：先跑一遍测试");
    expect(clarify("用户选择：A；自定义补充：再加个开关。")).toBe("已选：A；自定义补充：再加个开关");
    expect(clarify("用户未提供具体内容（视为按你的默认方案推进）。")).toBe("未作选择");
    expect(clarify("[CLARIFICATION_TIMEOUT] 用户未在时限内回复该提问。")).toBe("未在时限内答复");
    expect(clarify("[CLARIFICATION_PENDING] 当前为无人值守/自动化会话。")).toBe("无人值守，未答复");
  });

  it("returns null while the card is still waiting for an answer", () => {
    expect(confirm("")).toBeNull();
    expect(clarify("   ")).toBeNull();
  });

  it("clips a long selection instead of letting it push the row", () => {
    const long = clarify(`用户选择：${"选项".repeat(40)}。`);
    expect(long).not.toBeNull();
    expect(long!.length).toBeLessThanOrEqual(49);
    expect(long!.endsWith("…")).toBe(true);
  });
});

// 截图里的那一幕：用户点了取消，助手也回了「已取消」，
// 卡片标题却还是「等待你确认」。
describe("buildToolCardTitle for decision cards", () => {
  it("shows the cancellation instead of pretending it is still waiting", () => {
    expect(
      buildToolCardTitle(
        toolMessage({
          toolName: "request_action_confirmation",
          toolArgs: {},
          content: "[ACTION_REJECTED] 用户已取消执行。不得继续该动作。",
        }),
      ),
    ).toBe("已取消");
  });

  it("still says it is waiting when there is no answer yet", () => {
    expect(
      buildToolCardTitle(
        toolMessage({ toolName: "request_action_confirmation", toolArgs: {}, content: "" }),
      ),
    ).toBe("等待你确认");
    expect(
      buildToolCardTitle(
        toolMessage({ toolName: "request_clarification", toolArgs: {}, content: "" }),
      ),
    ).toBe("等待你补充信息");
  });
});
