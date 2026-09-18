import { describe, expect, it } from "vitest";
import { isPeerHumanSpeakerId, resolveUserBubbleName } from "./peer-human-speaker";

describe("isPeerHumanSpeakerId", () => {
  it("treats missing or owner ids as not peer", () => {
    expect(isPeerHumanSpeakerId(undefined)).toBe(false);
    expect(isPeerHumanSpeakerId(null)).toBe(false);
    expect(isPeerHumanSpeakerId("")).toBe(false);
    expect(isPeerHumanSpeakerId("user")).toBe(false);
  });

  it("treats human: ids as peer", () => {
    expect(isPeerHumanSpeakerId("human:feishu:ou_1")).toBe(true);
  });
});

describe("resolveUserBubbleName", () => {
  it("uses speakerName for peer humans", () => {
    expect(
      resolveUserBubbleName({
        speakerUserId: "human:feishu:ou_1",
        speakerName: "甲",
        fallbackMe: "我",
      }),
    ).toBe("甲");
  });

  it("falls back to me when peer name is empty", () => {
    expect(
      resolveUserBubbleName({
        speakerUserId: "human:feishu:ou_1",
        speakerName: "",
        fallbackMe: "我",
      }),
    ).toBe("我");
  });

  it("keeps fallback for owner rows", () => {
    expect(
      resolveUserBubbleName({
        speakerUserId: "user",
        speakerName: "我",
        fallbackMe: "我",
      }),
    ).toBe("我");
  });
});
