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
});
