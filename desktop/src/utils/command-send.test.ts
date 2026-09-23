import { describe, expect, it } from "vitest";
import { buildCommandSendText, composeRoomCommandSend } from "./command-send";

describe("buildCommandSendText", () => {
  it("returns instructions when extra is empty", () => {
    expect(buildCommandSendText("查看当前工作区改动", "  ")).toBe("查看当前工作区改动");
  });

  it("joins extra after a blank line", () => {
    expect(buildCommandSendText("查看当前工作区改动", "顺便看测试")).toBe(
      "查看当前工作区改动\n\n顺便看测试",
    );
  });
});

describe("composeRoomCommandSend", () => {
  it("prefixes the room draft with instructions", () => {
    const text = composeRoomCommandSend(
      { kind: "prompt", instructions: "查看当前工作区改动" },
      "顺便看测试",
    );
    expect(text.startsWith("查看当前工作区改动")).toBe(true);
    expect(text).toContain("顺便看测试");
  });
});
