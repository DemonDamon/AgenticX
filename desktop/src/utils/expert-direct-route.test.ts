import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeExpertAutoSendAck,
  markExpertAutoSendConsumed,
  matchExpertDirectSend,
} from "./expert-direct-route";

const avatars = [
  { id: "e901524f54f1", name: "阮和鸣" },
  { id: "a002", name: "文策渊" },
  { id: "group:g1", name: "群聊小队" },
];

describe("matchExpertDirectSend", () => {
  it("命中原测试用例：请让数字专家「阮和鸣」帮我完成任务。", () => {
    const hit = matchExpertDirectSend("请让数字专家「阮和鸣」帮我完成任务。", avatars);
    expect(hit).not.toBeNull();
    expect(hit?.avatarId).toBe("e901524f54f1");
    expect(hit?.avatarName).toBe("阮和鸣");
    expect(hit?.instruction).toBe("请让数字专家「阮和鸣」帮我完成任务。");
  });

  it("支持无请/无引号/『』引号变体", () => {
    expect(matchExpertDirectSend("让数字专家阮和鸣帮我完成任务。", avatars)?.avatarId).toBe("e901524f54f1");
    expect(matchExpertDirectSend("请让数字专家『阮和鸣』帮我完成任务。", avatars)?.avatarId).toBe("e901524f54f1");
    expect(matchExpertDirectSend("请让专家阮和鸣帮我完成任务。", avatars)?.avatarId).toBe("e901524f54f1");
  });

  it("原文追加任务内容时全文作为指令送达", () => {
    const text = "请让数字专家「阮和鸣」帮我完成任务。为《黑悟空》设计音效方案，要求覆盖 BGM/SFX。";
    const hit = matchExpertDirectSend(text, avatars);
    expect(hit?.avatarId).toBe("e901524f54f1");
    expect(hit?.instruction).toBe(text);
  });

  it("未知专家名不匹配", () => {
    expect(matchExpertDirectSend("请让数字专家「不存在的人」帮我完成任务。", avatars)).toBeNull();
  });

  it("非句首提及不拦截（普通消息不受影响）", () => {
    expect(matchExpertDirectSend("帮我总结一下，另外请让数字专家「阮和鸣」帮忙。", avatars)).toBeNull();
    expect(matchExpertDirectSend("什么是委派？", avatars)).toBeNull();
  });

  it("排除群聊头像", () => {
    expect(matchExpertDirectSend("请让数字专家「群聊小队」帮我完成任务。", avatars)).toBeNull();
  });

  it("空白与空串不匹配", () => {
    expect(matchExpertDirectSend("", avatars)).toBeNull();
    expect(matchExpertDirectSend("   ", avatars)).toBeNull();
  });
});

describe("autoSend ack", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("ack 写入后可被消费一次，重复消费返回 false", () => {
    expect(consumeExpertAutoSendAck("pane-1")).toBe(false);
    markExpertAutoSendConsumed("pane-1");
    expect(consumeExpertAutoSendAck("pane-1")).toBe(true);
    expect(consumeExpertAutoSendAck("pane-1")).toBe(false);
  });
});
