import { describe, expect, it } from "vitest";
import { parseBashBgStart } from "./bash-bg-preview";

describe("parseBashBgStart", () => {
  it("parses job fields and auth urls", () => {
    const payload = `job_id=abc123\nstatus=running\nexit_code=null\ncwd=/Users/damon/myWork/AgenticX\ncommand=lark-cli config init --new\ncaptured_output:\n...\nauth_urls:\n- https://open.feishu.cn/page/cli?code=1\n- https://open.feishu.cn/page/cli?code=2\nNOTE: Process is running in background and is not timeout-killed.`;
    const parsed = parseBashBgStart(payload);
    expect(parsed).not.toBeNull();
    expect(parsed?.jobId).toBe("abc123");
    expect(parsed?.status).toBe("running");
    expect(parsed?.cwd).toBe("/Users/damon/myWork/AgenticX");
    expect(parsed?.command).toBe("lark-cli config init --new");
    expect(parsed?.authUrls).toEqual([
      "https://open.feishu.cn/page/cli?code=1",
      "https://open.feishu.cn/page/cli?code=2",
    ]);
  });

  it("returns empty auth list when auth_urls has none", () => {
    const payload = `job_id=abc123\nstatus=exited\nauth_urls:\n(none)\nNOTE: done`;
    const parsed = parseBashBgStart(payload);
    expect(parsed?.jobId).toBe("abc123");
    expect(parsed?.status).toBe("exited");
    expect(parsed?.authUrls).toEqual([]);
  });

  it("returns null for non bash_bg_start text", () => {
    expect(parseBashBgStart("exit_code=0\nstdout:\nhello")).toBeNull();
  });
});
