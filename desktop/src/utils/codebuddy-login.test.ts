import { describe, expect, it } from "vitest";

import {
  buildCodebuddyLoginCommand,
  pickLoginCwd,
  sessionShowsCodebuddyLoginPrompt,
  writeCommandToTerminalTab,
} from "./codebuddy-login";

describe("codebuddy login prompt", () => {
  it("shows when the codebuddy turn is flagged", () => {
    expect(
      sessionShowsCodebuddyLoginPrompt(
        [
          { role: "user", content: "search" },
          {
            role: "assistant",
            content: "[harness codebuddy turn error] 400 Invalid request: invalid JSON request body",
            metadata: { harness: "codebuddy", codebuddy_login_required: true },
          },
        ],
        "codebuddy",
      ),
    ).toBe(true);
  });

  it("shows when the banner itself is a 401 authorization failure", () => {
    expect(
      sessionShowsCodebuddyLoginPrompt(
        [
          {
            role: "assistant",
            content: "[harness codebuddy turn error] 401 Unauthorized",
            metadata: { harness: "codebuddy", harness_status: "error" },
          },
        ],
        "codebuddy",
      ),
    ).toBe(true);
  });

  it("shows when the same turn's tool result is WebSearch 401 even if the banner is a 400", () => {
    expect(
      sessionShowsCodebuddyLoginPrompt(
        [
          { role: "user", content: "search" },
          {
            role: "tool",
            content: "error",
            toolName: "WebSearch",
            toolResultPreview:
              "Web Search API request failed with status 401: Authorization Required",
          },
          {
            role: "assistant",
            content: "[harness codebuddy turn error] 400 Invalid request: invalid JSON request body",
            metadata: { harness: "codebuddy", harness_status: "error" },
          },
        ],
        "codebuddy",
      ),
    ).toBe(true);
  });

  it("hides after a later successful codebuddy answer", () => {
    expect(
      sessionShowsCodebuddyLoginPrompt(
        [
          {
            role: "assistant",
            content: "[harness codebuddy turn error] 401 Unauthorized",
            metadata: { harness: "codebuddy", codebuddy_login_required: true },
          },
          { role: "user", content: "try again" },
          {
            role: "assistant",
            content: "done",
            metadata: { harness: "codebuddy", harness_status: "success" },
          },
        ],
        "codebuddy",
      ),
    ).toBe(false);
  });

  it("does not treat a claude-code 401 or a plain chat as a codebuddy login", () => {
    expect(
      sessionShowsCodebuddyLoginPrompt(
        [
          {
            role: "assistant",
            content: "[harness claude-code turn error] 401 Unauthorized",
            metadata: { harness: "claude-code", harness_status: "error" },
          },
        ],
        "claude-code",
      ),
    ).toBe(false);
    expect(
      sessionShowsCodebuddyLoginPrompt(
        [{ role: "assistant", content: "401 Unauthorized means the caller is not logged in" }],
        "python-agent",
      ),
    ).toBe(false);
  });

  it("does not flag a successful codebuddy answer that merely mentions login", () => {
    expect(
      sessionShowsCodebuddyLoginPrompt(
        [
          {
            role: "assistant",
            content: "You can login later. This answer is fine.",
            metadata: { harness: "codebuddy", harness_status: "success" },
          },
        ],
        "codebuddy",
      ),
    ).toBe(false);
  });
});

describe("codebuddy login command", () => {
  it("runs login through the taskspace binary, then PATH codebuddy / cbc, then the app bundle", () => {
    const cmd = buildCodebuddyLoginCommand("posix");
    expect(cmd).toContain(".cb/bin/codebuddy");
    expect(cmd).toContain("command -v codebuddy");
    expect(cmd).toContain("command -v cbc");
    expect(cmd).toContain("WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy");
    expect(cmd).toContain('"$CB" login');
    expect(cmd.toLowerCase()).not.toContain("oauth");
    expect(cmd).not.toContain("token");
  });

  it("uses a powershell login on windows", () => {
    const cmd = buildCodebuddyLoginCommand("windows");
    expect(cmd).toContain(".cb\\bin\\codebuddy");
    expect(cmd).toContain("login");
    expect(cmd.toLowerCase()).not.toContain("oauth");
  });
});

describe("codebuddy login terminal", () => {
  it("prefers the active workspace directory", () => {
    expect(
      pickLoginCwd(
        [
          { id: "default", path: "/tmp/default" },
          { id: "active", path: "/tmp/active" },
        ],
        "active",
      ),
    ).toBe("/tmp/active");
    expect(pickLoginCwd([], null)).toBe("~");
  });

  it("writes the command after the terminal tab exists", async () => {
    const writes: string[] = [];
    let tab: string | null = null;
    let ready = "";
    const result = await writeCommandToTerminalTab({
      cwd: "/tmp/ws",
      label: "login",
      command: "echo hi",
      addTab: () => {
        tab = "tab-1";
      },
      readActiveTabId: () => tab,
      onTabReady: (tabId) => {
        ready = tabId;
      },
      write: async (_tabId, data) => {
        writes.push(data);
        return { ok: writes.length > 1 };
      },
      sleep: async () => {},
    });
    expect(ready).toBe("tab-1");
    expect(result).toEqual({ ok: true, tabId: "tab-1" });
    expect(writes.at(-1)).toBe("echo hi\n");
  });
});
