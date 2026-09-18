import { describe, expect, it, vi } from "vitest";

import {
  buildLoginItemSettings,
  parseTaskCompleteNotifyPayload,
  playCompletionSound,
  shouldStartHidden,
  welcomeNotificationCopy,
} from "../electron/desktop-notify";

describe("parseTaskCompleteNotifyPayload", () => {
  it("accepts a valid payload and clips title/body to 80", () => {
    const parsed = parseTaskCompleteNotifyPayload({
      title: `任务完成 · ${"x".repeat(90)}`,
      body: "y".repeat(90),
      paneId: " pane-meta ",
      sessionId: " s1 ",
      showBanner: true,
      playSound: false,
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.title.length).toBe(80);
    expect(parsed.body.length).toBe(80);
    expect(parsed.paneId).toBe("pane-meta");
    expect(parsed.sessionId).toBe("s1");
  });

  it("rejects invalid payloads without throwing", () => {
    expect(parseTaskCompleteNotifyPayload(null).ok).toBe(false);
    expect(parseTaskCompleteNotifyPayload({ title: 1, body: "x", showBanner: true, playSound: true }).ok).toBe(false);
    expect(parseTaskCompleteNotifyPayload({ title: "  ", body: "x", showBanner: true, playSound: true }).ok).toBe(false);
  });
});

describe("buildLoginItemSettings", () => {
  it("builds platform-specific login items", () => {
    expect(buildLoginItemSettings({ openAtLogin: true, platform: "darwin" })).toEqual({
      openAtLogin: true,
      openAsHidden: true,
      type: "mainAppService",
    });
    expect(buildLoginItemSettings({ openAtLogin: true, platform: "win32" })).toEqual({
      openAtLogin: true,
      args: ["--hidden"],
    });
    expect(buildLoginItemSettings({ openAtLogin: false, platform: "darwin" })).toEqual({
      openAtLogin: false,
    });
  });
});

describe("shouldStartHidden", () => {
  it("never hides unpackaged launches unless --hidden is passed", () => {
    expect(shouldStartHidden({
      argv: ["electron", "."],
      wasOpenedAtLogin: true,
      isPackaged: false,
    })).toBe(false);
    expect(shouldStartHidden({
      argv: ["electron", ".", "--hidden"],
      wasOpenedAtLogin: false,
      isPackaged: false,
    })).toBe(true);
  });

  it("hides packaged login / --hidden starts", () => {
    expect(shouldStartHidden({
      argv: ["Near"],
      wasOpenedAtLogin: true,
      isPackaged: true,
    })).toBe(true);
    expect(shouldStartHidden({
      argv: ["Near", "--hidden"],
      wasOpenedAtLogin: false,
      isPackaged: true,
    })).toBe(true);
    expect(shouldStartHidden({
      argv: ["Near"],
      wasOpenedAtLogin: false,
      wasOpenedAsHidden: true,
      isPackaged: true,
    })).toBe(true);
  });
});

describe("playCompletionSound", () => {
  it("uses afplay on macOS and does not throw", () => {
    const execFile = vi.fn();
    playCompletionSound(execFile as never, "darwin");
    expect(execFile).toHaveBeenCalledWith(
      "/usr/bin/afplay",
      ["/System/Library/Sounds/Glass.aiff"],
      expect.any(Function),
    );
  });
});

describe("welcomeNotificationCopy", () => {
  it("returns localized welcome copy", () => {
    expect(welcomeNotificationCopy("zh").title).toBe("Near 已就绪");
    expect(welcomeNotificationCopy("en").title).toBe("Near is ready");
  });
});
