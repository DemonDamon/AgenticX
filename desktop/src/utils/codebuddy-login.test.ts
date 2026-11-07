import { describe, expect, it } from "vitest";

import {
  assistantShowsResolvedCodebuddyLoginNotice,
  assistantTurnNeedsCodebuddyLogin,
  buildCodebuddyLoginCommand,
  paneAwaitingCodebuddyLoginRetry,
  pickLoginCwd,
  sessionShowsCodebuddyLoginPrompt,
  shouldSuppressCodebuddyHarnessErrorBody,
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

  it("only shows the live CTA on the latest failing assistant row", () => {
    const messages = [
      { role: "user", content: "q1" },
      {
        role: "assistant",
        id: "old",
        content: "[harness codebuddy turn error] 400 Invalid request: invalid JSON request body",
        metadata: { harness: "codebuddy", codebuddy_login_required: true },
      },
      { role: "user", content: "q2" },
      {
        role: "assistant",
        id: "new",
        content: "done",
        metadata: { harness: "codebuddy", harness_status: "success" },
      },
    ] as const;
    const oldMsg = messages[1];
    const newMsg = messages[3];
    expect(assistantTurnNeedsCodebuddyLogin(oldMsg, [...messages], "codebuddy")).toBe(false);
    expect(assistantTurnNeedsCodebuddyLogin(newMsg, [...messages], "codebuddy")).toBe(false);
    expect(assistantShowsResolvedCodebuddyLoginNotice(oldMsg, [...messages], "codebuddy")).toBe(
      true,
    );
  });

  it("suppresses harness error bodies for login-required metadata", () => {
    const messages = [
      {
        role: "assistant",
        content: "[harness codebuddy turn error] 400 Invalid request: invalid JSON request body",
        metadata: { harness: "codebuddy", codebuddy_login_required: true },
      },
    ];
    expect(shouldSuppressCodebuddyHarnessErrorBody(messages[0], messages, "codebuddy")).toBe(true);
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

  it("writes the command into the shell pty after the tab exists", async () => {
    const writes: string[] = [];
    let ready = "";
    const result = await writeCommandToTerminalTab({
      cwd: "/tmp/ws",
      label: "zsh",
      command: "echo hi",
      addTab: () => "tab-1",
      onTabReady: (tabId) => {
        ready = tabId;
      },
      waitPtyReady: async () => true,
      writePty: async (_tabId, data) => {
        writes.push(data);
        return { ok: writes.length > 0 };
      },
      sleep: async () => {},
    });
    expect(ready).toBe("tab-1");
    expect(result).toEqual({ ok: true, tabId: "tab-1" });
    expect(writes.at(-1)).toBe("echo hi\n");
  });

  it("tracks awaiting-retry session match", () => {
    expect(paneAwaitingCodebuddyLoginRetry("s1", "s1")).toBe(true);
    expect(paneAwaitingCodebuddyLoginRetry("s1", "s2")).toBe(false);
    expect(
      sessionShowsCodebuddyLoginPrompt(
        [
          {
            role: "assistant",
            content: "[harness codebuddy turn error] 401",
            metadata: { harness: "codebuddy", codebuddy_login_required: true },
          },
        ],
        "codebuddy",
        { suppressWhileAwaitingRetry: true },
      ),
    ).toBe(false);
  });
});
