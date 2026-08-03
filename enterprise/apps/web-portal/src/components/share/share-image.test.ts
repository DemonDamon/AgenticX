import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChatShareSnapshot } from "../../lib/chat-share-types";
import { createSharePng, downloadShareImage, prepareShareImageMessages } from "./share-image";

const snapshot: ChatShareSnapshot = {
  token: "preview",
  session_id: "session-1",
  title: "测试对话",
  created_at: "2026-08-03T00:00:00.000Z",
  messages: [
    {
      id: "u1",
      role: "user",
      content: "问题",
      created_at: "2026-08-03T00:00:00.000Z",
    },
    {
      id: "a1",
      role: "assistant",
      content: "<think>内部推理</think>\n# 回答\n\n| 项目 | 内容 |\n| --- | --- |\n| 结果 | 已完成 |",
      created_at: "2026-08-03T00:00:01.000Z",
    },
  ],
};

const originalDocument = globalThis.document;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: originalDocument,
  });
});

describe("share image", () => {
  it("keeps the complete user-assistant turn and sanitizes reasoning", () => {
    const messages = prepareShareImageMessages(snapshot);
    expect(messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(messages[1]?.content).not.toContain("<think>");
  });

  it("draws both sides of a selected turn as readable text", async () => {
    const drawnText: string[] = [];
    const context = {
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      measureText: (value: string) => ({ width: value.length * 10 }),
      fillText: (value: string) => drawnText.push(value),
      fillRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      arcTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob(["png"], { type: "image/png" })),
    };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: { createElement: () => canvas },
    });

    await createSharePng(snapshot);

    expect(drawnText).toContain("用户");
    expect(drawnText).toContain("助手");
    expect(drawnText.join("\n")).toContain("回答");
    expect(drawnText.join("\n")).not.toContain("<think>");
    expect(drawnText.join("\n")).not.toContain("|");
  });

  it("coalesces concurrent image requests into one download", async () => {
    const anchorClicks: string[] = [];
    const context = {
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 0,
      measureText: (value: string) => ({ width: value.length * 10 }),
      fillText: () => {},
      fillRect: () => {},
      beginPath: () => {},
      moveTo: () => {},
      arcTo: () => {},
      closePath: () => {},
      fill: () => {},
      stroke: () => {},
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => context,
      toBlob: (callback: (blob: Blob | null) => void) => callback(new Blob(["png"], { type: "image/png" })),
    };
    const anchor = {
      href: "",
      download: "",
      click: () => anchorClicks.push(anchor.download),
      remove: () => {},
    };
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        createElement: (tag: string) => (tag === "canvas" ? canvas : anchor),
        body: { appendChild: () => {} },
      },
    });
    vi.stubGlobal("window", { setTimeout });
    vi.stubGlobal("URL", { createObjectURL: () => "blob:test", revokeObjectURL: () => {} });

    const nativeShare = vi.fn();
    vi.stubGlobal("navigator", { share: nativeShare });

    const first = downloadShareImage(snapshot, "conversation.png");
    const second = downloadShareImage(snapshot, "conversation.png");
    await Promise.all([first, second]);
    expect(anchorClicks).toEqual(["conversation.png"]);
    expect(nativeShare).not.toHaveBeenCalled();
  });
});
