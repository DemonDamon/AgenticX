import { describe, expect, it } from "vitest";
import { filterMessagesForCompletion } from "./store";
import type { ChatMessage } from "@agenticx/core-api";

function msg(partial: Partial<ChatMessage> & Pick<ChatMessage, "role" | "content">): ChatMessage {
  return {
    id: partial.id ?? "id",
    session_id: partial.session_id ?? "s1",
    tenant_id: partial.tenant_id ?? "t1",
    user_id: partial.user_id ?? "u1",
    role: partial.role,
    content: partial.content,
    created_at: partial.created_at ?? "2026-07-30T00:00:00.000Z",
    ...(partial.interruption ? { interruption: partial.interruption } : {}),
    ...(partial.control ? { control: partial.control } : {}),
  };
}

describe("filterMessagesForCompletion", () => {
  it("excludes empty assistant placeholders from upstream payload", () => {
    const out = filterMessagesForCompletion([
      msg({ role: "user", content: "hello" }),
      msg({ role: "assistant", content: "" }),
    ]);
    expect(out.map((m) => m.role)).toEqual(["user"]);
  });

  it("keeps completed assistant replies", () => {
    const out = filterMessagesForCompletion([
      msg({ role: "user", content: "hello" }),
      msg({ role: "assistant", content: "hi" }),
      msg({ role: "user", content: "again" }),
      msg({ role: "assistant", content: "" }),
    ]);
    expect(out.map((m) => m.content)).toEqual(["hello", "hi", "again"]);
  });

  it("excludes error-only replies and preserves generated text before an error", () => {
    const error = "回复已中断，已保留已生成内容。可继续生成或重试。";
    const prefix = "已生成的内容。 ";
    const messages = [
      msg({ role: "assistant", content: error, interruption: { reason: "failed", contentLength: 0 } }),
      msg({
        role: "assistant",
        content: `${prefix}\n\n${error}`,
        interruption: { reason: "failed", contentLength: prefix.length },
      }),
      msg({ role: "user", content: "广州天气如何" }),
    ];
    const out = filterMessagesForCompletion(messages);
    expect(out.map((message) => message.content)).toEqual([prefix, "广州天气如何"]);
    expect(messages[1]?.content).toContain(error);
  });

  it("keeps assistant answers without historical reasoning and leaves user text intact", () => {
    const thought = "<think>我可能无法联网</think>";
    const messages = [
      msg({ role: "user", content: thought }),
      msg({ role: "assistant", content: `${thought}查到的天气结论。` }),
      msg({ role: "assistant", content: "<think>只产生了思考" }),
    ];
    expect(filterMessagesForCompletion(messages).map((message) => message.content)).toEqual([
      thought,
      "查到的天气结论。",
    ]);
    expect(messages[1]?.content).toContain(thought);
  });

  it("omits report continuation control messages from model history", () => {
    const out = filterMessagesForCompletion([
      msg({ role: "user", content: "原始问题" }),
      msg({ role: "user", content: "继续完成报告", control: "continue_report" }),
      msg({ role: "assistant", content: "续写中的报告" }),
    ]);
    expect(out.map((message) => message.content)).toEqual(["原始问题", "续写中的报告"]);
  });

  it("retains the available answer of a cancelled turn", () => {
    const content = "<think>分析</think>已生成的正文";
    const out = filterMessagesForCompletion([
      msg({
        role: "assistant",
        content,
        interruption: { reason: "cancelled", contentLength: content.length },
      }),
    ]);
    expect(out[0]?.content).toBe("已生成的正文");
  });
});
