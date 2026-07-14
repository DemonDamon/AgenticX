import { describe, expect, it } from "vitest";

import { mapLoadedSessionMessage } from "../src/utils/session-message-map";

describe("session message action confirmation restore", () => {
  it("restores pending action confirmation from clarification metadata context", () => {
    const mapped = mapLoadedSessionMessage(
      {
        role: "tool",
        content: "确认发送这封邮件？",
        tool_name: "request_action_confirmation",
        tool_status: "running",
        metadata: {
          kind: "clarification",
          request_id: "req-action-1",
          prompt: "确认发送这封邮件？",
          options: ["确认发送", "取消"],
          allow_free_text: true,
          context: {
            kind: "action_confirmation",
            title: "确认发送这封邮件？",
            summary: [
              { label: "收件人", value: "a@b.com" },
              { label: "主题", value: "hello" },
            ],
            approve_label: "确认发送",
            reject_label: "取消",
            expires_at_ms: Date.now() + 60_000,
            source: "Agent Mail",
          },
        },
      },
      "sess-1",
      0,
      "sess-1",
    );

    expect(mapped.actionConfirmation).toBeTruthy();
    expect(mapped.actionConfirmation?.requestId).toBe("req-action-1");
    expect(mapped.actionConfirmation?.status).toBe("pending");
    expect(mapped.actionConfirmation?.approveLabel).toBe("确认发送");
    expect(mapped.clarificationPrompt).toBeUndefined();
  });

  it("restores approved action confirmation from clarification_answered", () => {
    const mapped = mapLoadedSessionMessage(
      {
        role: "tool",
        content: "确认发布？",
        metadata: {
          kind: "clarification",
          request_id: "req-action-2",
          clarification_answered: true,
          clarification_answer: {
            answer_text: "",
            selected_options: ["确认执行"],
          },
          context: {
            kind: "action_confirmation",
            title: "确认发布？",
            summary: [],
            approve_label: "确认执行",
            reject_label: "取消",
            expires_at_ms: Date.now() + 60_000,
          },
        },
      },
      "sess-2",
      0,
      "sess-2",
    );

    expect(mapped.actionConfirmation?.status).toBe("approved");
  });

  it("expired action confirmation restores as expired", () => {
    const mapped = mapLoadedSessionMessage(
      {
        role: "tool",
        content: "确认？",
        metadata: {
          kind: "clarification",
          request_id: "req-action-3",
          context: {
            kind: "action_confirmation",
            title: "确认？",
            summary: [],
            approve_label: "确认执行",
            reject_label: "取消",
            expires_at_ms: Date.now() - 1000,
          },
        },
      },
      "sess-3",
      0,
      "sess-3",
    );

    expect(mapped.actionConfirmation?.status).toBe("expired");
  });
});
