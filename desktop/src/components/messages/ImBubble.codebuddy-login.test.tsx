// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { ImBubble } from "./ImBubble";

afterEach(() => {
  cleanup();
});

describe("ImBubble codebuddy login", () => {
  it("replaces the harness 400 bubble with an inline re-login CTA", async () => {
    await i18n.changeLanguage("zh");
    const onLogin = vi.fn();
    render(
      <ImBubble
        message={{
          id: "a-fail",
          role: "assistant",
          content:
            "[harness codebuddy turn error] 400 Invalid request: invalid JSON request body",
          metadata: { harness: "codebuddy", codebuddy_login_required: true },
        }}
        conversationMessages={[
          { role: "user", content: "search", id: "u1" },
          {
            id: "a-fail",
            role: "assistant",
            content:
              "[harness codebuddy turn error] 400 Invalid request: invalid JSON request body",
            metadata: { harness: "codebuddy", codebuddy_login_required: true },
          },
        ]}
        activeHarnessId="codebuddy"
        onCodebuddyLogin={onLogin}
      />,
    );
    expect(screen.queryByText(/invalid JSON request body/)).toBeNull();
    const button = screen.getByRole("button", { name: /CodeBuddy 腾讯登录已失效，点击重新登录/ });
    fireEvent.click(button);
    expect(onLogin).toHaveBeenCalledOnce();
  });

  it("shows oauth success tip only after authorization finished", async () => {
    await i18n.changeLanguage("zh");
    render(
      <ImBubble
        message={{
          id: "a-fail",
          role: "assistant",
          content:
            "[harness codebuddy turn error] 400 Invalid request: invalid JSON request body",
          metadata: { harness: "codebuddy", codebuddy_login_required: true },
        }}
        conversationMessages={[
          { role: "user", content: "search", id: "u1" },
          {
            id: "a-fail",
            role: "assistant",
            content:
              "[harness codebuddy turn error] 400 Invalid request: invalid JSON request body",
            metadata: { harness: "codebuddy", codebuddy_login_required: true },
          },
        ]}
        activeHarnessId="codebuddy"
        codebuddyLoginAwaitingRetry
      />,
    );
    expect(screen.getByText(/授权成功/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /点击重新登录/ })).toBeNull();
  });

  it("shows authorizing tip while oauth is in progress", async () => {
    await i18n.changeLanguage("zh");
    render(
      <ImBubble
        message={{
          id: "a-fail",
          role: "assistant",
          content:
            "[harness codebuddy turn error] 400 Invalid request: invalid JSON request body",
          metadata: { harness: "codebuddy", codebuddy_login_required: true },
        }}
        conversationMessages={[
          { role: "user", content: "search", id: "u1" },
          {
            id: "a-fail",
            role: "assistant",
            content:
              "[harness codebuddy turn error] 400 Invalid request: invalid JSON request body",
            metadata: { harness: "codebuddy", codebuddy_login_required: true },
          },
        ]}
        activeHarnessId="codebuddy"
        codebuddyLoginAuthorizing
      />,
    );
    expect(screen.getByText(/正在打开浏览器完成腾讯授权/)).toBeTruthy();
    expect(screen.queryByText(/登录已在终端启动/)).toBeNull();
  });
});
