import { describe, expect, it } from "vitest";
import { buildCommandSendText, buildPerfDiagnosisText, composeRoomCommandSend, parsePerfCommandInput } from "./command-send";

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

describe("parsePerfCommandInput", () => {
  it("uses the current session when the box is empty", () => {
    expect(parsePerfCommandInput("  ", "sess-1")).toEqual({ sessionId: "sess-1", note: "" });
  });

  it("takes a bare session id", () => {
    expect(parsePerfCommandInput("072b56eb-758b-4d47-8393-a9dab0966a8d", "sess-1")).toEqual({
      sessionId: "072b56eb-758b-4d47-8393-a9dab0966a8d",
      note: "",
    });
  });

  it("keeps a vague performance request off the session id", () => {
    expect(parsePerfCommandInput("072b56eb-758b-4d47-8393-a9dab0966a8d 看看性能", "")).toEqual({
      sessionId: "072b56eb-758b-4d47-8393-a9dab0966a8d",
      note: "看看性能",
    });
  });
});

describe("buildPerfDiagnosisText", () => {
  const summary = {
    session_id: "sess-1",
    runs: [{ status: "completed", wall_ms: 151800, ttft_ms: 10100 }],
    latest: {
      model: "mimo-v2.6-pro",
      status: "completed",
      wall_ms: 151800,
      ttft_ms: 10100,
      model_waits: [{ until: "assistant_output_completed", wait_ms: 92000 }],
      model_wait_total_ms: 141100,
      tool_elapsed_ms: 1100,
      slowest_tool: { name: "tool_search", elapsed_ms: 210 },
      output_tokens: 2340,
      turn_output_tokens: 2894,
      output_tokens_per_sec: 20.5,
    },
  };

  it("hands the numbers to the model when the user only asks to look", () => {
    const text = buildPerfDiagnosisText(summary, "看看性能");
    expect(text).toContain("不要调用任何工具");
    expect(text).toContain("没有提出具体问题");
    expect(text).toContain("20.5 tokens/s");
    expect(text).toContain("输出 token 2894");
    expect(text).not.toContain("用户的问题");
  });

  it("keeps a specific question with the data", () => {
    const text = buildPerfDiagnosisText(summary, "为什么首 token 这么慢");
    expect(text).toContain("用户的问题：为什么首 token 这么慢");
    expect(text).toContain("mimo-v2.6-pro");
  });
});
