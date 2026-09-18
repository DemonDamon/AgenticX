import { describe, expect, it } from "vitest";
import {
  shouldAnnounceTaskComplete,
  decideNotifyPresentation,
  formatTaskNotifyTitle,
  formatTaskNotifyBody,
} from "./desktop-task-notify";

describe("shouldAnnounceTaskComplete", () => {
  const base = {
    aborted: false,
    hasQueuedFollowup: false,
    isGroupPane: false,
    receivedFinalEvent: true,
    receivedGroupDone: false,
    text: "你好，任务已完成。",
  };

  it("announces a 1:1 final with visible text", () => {
    expect(shouldAnnounceTaskComplete(base)).toBe(true);
  });

  it("skips abort, queued follow-up, empty, and think-only", () => {
    expect(shouldAnnounceTaskComplete({ ...base, aborted: true })).toBe(false);
    expect(shouldAnnounceTaskComplete({ ...base, hasQueuedFollowup: true })).toBe(false);
    expect(shouldAnnounceTaskComplete({ ...base, text: "   " })).toBe(false);
    expect(shouldAnnounceTaskComplete({ ...base, text: "<think>secret</think>" })).toBe(false);
  });

  it("announces group only on done", () => {
    expect(shouldAnnounceTaskComplete({
      ...base, isGroupPane: true, receivedFinalEvent: true, receivedGroupDone: false,
    })).toBe(false);
    expect(shouldAnnounceTaskComplete({
      ...base, isGroupPane: true, receivedFinalEvent: false, receivedGroupDone: true,
    })).toBe(true);
  });
});

describe("decideNotifyPresentation", () => {
  it("banners when unfocused; sound-only when focused", () => {
    expect(decideNotifyPresentation({
      desktopNotify: true, desktopSound: true, windowFocusedAndVisible: false,
    })).toEqual({ showBanner: true, playSound: true });
    expect(decideNotifyPresentation({
      desktopNotify: true, desktopSound: true, windowFocusedAndVisible: true,
    })).toEqual({ showBanner: false, playSound: true });
  });

  it("is silent when both switches are off", () => {
    expect(decideNotifyPresentation({
      desktopNotify: false, desktopSound: false, windowFocusedAndVisible: false,
    })).toEqual({ showBanner: false, playSound: false });
  });
});

describe("formatTaskNotifyTitle / formatTaskNotifyBody", () => {
  it("uses locale prefixes and falls back to Near", () => {
    expect(formatTaskNotifyTitle("success", "问候交流", "zh")).toBe("任务完成 · 问候交流");
    expect(formatTaskNotifyTitle("error", "", "en")).toBe("Task failed · Near");
  });

  it("strips think tags, collapses whitespace, and clips to 80 chars", () => {
    expect(formatTaskNotifyBody("<think>hide</think>  你好   世界")).toBe("你好 世界");
    const long = "x".repeat(90);
    const clipped = formatTaskNotifyBody(long);
    expect(clipped.length).toBe(80);
    expect(clipped.endsWith("…")).toBe(true);
  });
});
