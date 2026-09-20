import { describe, expect, it } from "vitest";
import { formatBashExecUserView, resolveBashExecCardText } from "./bash-exec-result";

const EMPTY_OK = "exit_code=0\nstdout:\n(empty)\nstderr:\n(empty)";
const FAIL_STDERR = [
  "exit_code=1",
  "stdout:",
  "(empty)",
  "stderr:",
  "wc: /tmp/typesafe_skill.md: open: No such file or directory",
  "head: /tmp/typesafe_skill.md: No such file or directory",
].join("\n");

describe("formatBashExecUserView", () => {
  it("hides the empty success envelope", () => {
    const view = formatBashExecUserView(EMPTY_OK);
    expect(view.matched).toBe(true);
    expect(view.exitCode).toBe(0);
    expect(view.output).toBe("");
  });

  it("keeps stderr and drops protocol labels on failure", () => {
    const view = formatBashExecUserView(FAIL_STDERR);
    expect(view.matched).toBe(true);
    expect(view.exitCode).toBe(1);
    expect(view.output).toBe(
      [
        "wc: /tmp/typesafe_skill.md: open: No such file or directory",
        "head: /tmp/typesafe_skill.md: No such file or directory",
      ].join("\n"),
    );
    expect(view.output).not.toMatch(/exit_code=/);
    expect(view.output).not.toMatch(/^\s*stdout:/m);
    expect(view.output).not.toContain("(empty)");
  });

  it("keeps real stdout on success", () => {
    const view = formatBashExecUserView("exit_code=0\nstdout:\nhello\nworld\nstderr:\n(empty)");
    expect(view.output).toBe("hello\nworld");
  });

  it("strips model-facing HINT / OUTPUT_HINT tails", () => {
    const hinted = `${FAIL_STDERR}\n\n[HINT] 检测到 shell 元字符（如 2>&1）`;
    expect(formatBashExecUserView(hinted).output).toBe(
      [
        "wc: /tmp/typesafe_skill.md: open: No such file or directory",
        "head: /tmp/typesafe_skill.md: No such file or directory",
      ].join("\n"),
    );

    const outputHint = "exit_code=0\nstdout:\n/tmp/demo.md\nstderr:\n(empty)\nOUTPUT_HINT: stdout 已包含 1 个非空行";
    expect(formatBashExecUserView(outputHint).output).toBe("/tmp/demo.md");
  });

  it("treats exit_code-only success as an empty envelope", () => {
    const view = formatBashExecUserView("exit_code=0");
    expect(view.matched).toBe(true);
    expect(view.output).toBe("");
  });

  it("leaves non-envelope errors untouched", () => {
    const raw = "ERROR: command timeout after 30s";
    expect(formatBashExecUserView(raw)).toEqual({
      matched: false,
      exitCode: null,
      output: raw,
    });
  });

  it("accepts CRLF envelopes from persisted history", () => {
    const view = formatBashExecUserView("exit_code=0\r\nstdout:\r\nok\r\nstderr:\r\n(empty)");
    expect(view.matched).toBe(true);
    expect(view.output).toBe("ok");
  });
});

describe("resolveBashExecCardText", () => {
  const failedLabel = (code: number) => `命令失败（退出码 ${code}）`;

  it("returns empty text for silent success so the card can hide its body", () => {
    expect(resolveBashExecCardText(EMPTY_OK, failedLabel)).toEqual({
      matched: true,
      text: "",
    });
  });

  it("uses the failed label when both streams are empty", () => {
    expect(resolveBashExecCardText("exit_code=1\nstdout:\n(empty)\nstderr:\n(empty)", failedLabel)).toEqual({
      matched: true,
      text: "命令失败（退出码 1）",
    });
  });

  it("prefers real output over the failed label", () => {
    expect(resolveBashExecCardText(FAIL_STDERR, failedLabel).text).toContain("No such file");
  });
});
