import { describe, expect, it } from "vitest";
import {
  formatWbBridgeSendToolResult,
  wbBridgeSendToolProgressLabel,
} from "./wb-bridge-ui";

describe("formatWbBridgeSendToolResult", () => {
  it("formats success with result_text", () => {
    const out = formatWbBridgeSendToolResult(
      JSON.stringify({ status: "success", result_text: "Hello, World!", ok: true }),
    );
    expect(out).toContain("Hello, World!");
  });

  it("formats running and asks not to resend", () => {
    const out = formatWbBridgeSendToolResult(
      JSON.stringify({ status: "running", turn_seq: 2, last_activity: "Write" }),
    );
    expect(out).toContain("勿重复投递");
  });

  it("formats blocked with acceptEdits guidance", () => {
    const out = formatWbBridgeSendToolResult(
      JSON.stringify({ status: "blocked", terminal_detail: "Bash" }),
    );
    expect(out).toContain("acceptEdits");
  });

  it("formats error with terminal_detail", () => {
    const out = formatWbBridgeSendToolResult(
      JSON.stringify({ status: "error", terminal_detail: "error_max_turns" }),
    );
    expect(out).toContain("error_max_turns");
  });

  it("formats exited and asks to reopen", () => {
    const out = formatWbBridgeSendToolResult(JSON.stringify({ status: "exited" }));
    expect(out).toContain("重开会话");
  });

  it("shows committed side effects for blocked tools", () => {
    const out = formatWbBridgeSendToolResult(
      JSON.stringify({
        status: "blocked",
        observed_tools: ["Write", "Bash"],
        terminal_detail: "Bash",
      }),
    );
    expect(out).toContain("Write → Bash");
    expect(out).toContain("重试前请先核验");
  });

  it("marks stalled running turns", () => {
    const out = formatWbBridgeSendToolResult(
      JSON.stringify({ status: "running", stalled: true }),
    );
    expect(out).toContain("疑似等待确认");
  });

  it("prefixes deduplicated success", () => {
    const out = formatWbBridgeSendToolResult(
      JSON.stringify({ status: "success", result_text: "ok", deduplicated: true }),
    );
    expect(out?.startsWith("（重复投递已去重）")).toBe(true);
  });

  it("appends usage on success", () => {
    const out = formatWbBridgeSendToolResult(
      JSON.stringify({
        status: "success",
        result_text: "ok",
        turns_completed: 22,
        usage_totals: { input_tokens: 197000, output_tokens: 285 },
      }),
    );
    expect(out).toContain("22");
    expect(out).toContain("197000");
  });

  it("omits tokens when usage_totals is missing", () => {
    const out = formatWbBridgeSendToolResult(
      JSON.stringify({ status: "success", result_text: "ok" }),
    );
    expect(out).not.toContain("tokens");
  });

  it("returns null for non-json", () => {
    expect(formatWbBridgeSendToolResult("not json")).toBeNull();
  });

  it("falls back to ok+result_text without status", () => {
    const out = formatWbBridgeSendToolResult(
      JSON.stringify({ ok: true, result_text: "hi" }),
    );
    expect(out).toContain("hi");
  });

  it("falls back to tail when status is missing", () => {
    const out = formatWbBridgeSendToolResult(
      JSON.stringify({ ok: false, tail: "some tail" }),
    );
    expect(out).toContain("some tail");
  });
});

describe("wbBridgeSendToolProgressLabel", () => {
  it("includes elapsed seconds and no-resend hint", () => {
    const out = wbBridgeSendToolProgressLabel(12);
    expect(out).toContain("12s");
    expect(out).toContain("勿重复投递");
  });

  it("mentions wb-bridge when elapsed is unknown", () => {
    expect(wbBridgeSendToolProgressLabel(null)).toContain("wb-bridge");
  });
});
