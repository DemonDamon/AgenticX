// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { i18n } from "../../i18n/i18n";
import { CodebuddyLoginPrompt } from "./CodebuddyLoginPrompt";

afterEach(() => {
  cleanup();
});

describe("CodebuddyLoginPrompt", () => {
  it("renders the Chinese login CTA and calls onLogin", async () => {
    await i18n.changeLanguage("zh");
    const onLogin = vi.fn();
    render(<CodebuddyLoginPrompt onLogin={onLogin} />);
    const button = screen.getByRole("button", { name: /CodeBuddy 腾讯登录已失效，点击重新登录/ });
    fireEvent.click(button);
    expect(onLogin).toHaveBeenCalledOnce();
  });

  it("renders the English login CTA", async () => {
    await i18n.changeLanguage("en");
    render(<CodebuddyLoginPrompt onLogin={() => undefined} />);
    expect(
      screen.getByRole("button", { name: /CodeBuddy Tencent login expired/ }),
    ).toBeTruthy();
  });
});
