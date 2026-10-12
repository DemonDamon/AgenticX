import { describe, expect, it } from "vitest";
import { composeRoomCommandSend } from "../utils/command-send";

describe("CollabRoomPanel command send", () => {
  it("prefixes the room draft with the command instructions", () => {
    const text = composeRoomCommandSend(
      { kind: "prompt", instructions: "查看当前工作区改动" },
      "顺便看测试",
    );
    expect(text.startsWith("查看当前工作区改动")).toBe(true);
    expect(text).toContain("\n\n顺便看测试");
  });
});
