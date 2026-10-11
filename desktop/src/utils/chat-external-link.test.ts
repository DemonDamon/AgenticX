import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmChatExternalLinkOpen,
  dismissChatExternalLinkPrompt,
  getPendingChatExternalLink,
  requestChatHttpLink,
  _resetChatExternalLinkForTests,
} from "./chat-external-link";
import { addTrustedExternalHost, _resetTrustedExternalHostsForTests } from "./trusted-external-hosts";

afterEach(() => {
  _resetChatExternalLinkForTests();
  _resetTrustedExternalHostsForTests();
});

describe("requestChatHttpLink", () => {
  it("prompts for an untrusted http(s) link and does not open yet", () => {
    const open = vi.fn();
    requestChatHttpLink("https://drive.tencent.com/home", open);
    expect(open).not.toHaveBeenCalled();
    expect(getPendingChatExternalLink()?.url).toBe("https://drive.tencent.com/home");
  });

  it("opens immediately when the host is already trusted", () => {
    const open = vi.fn();
    addTrustedExternalHost("https://drive.tencent.com/home");
    requestChatHttpLink("https://drive.tencent.com/other", open);
    expect(open).toHaveBeenCalledTimes(1);
    expect(getPendingChatExternalLink()).toBeNull();
  });

  it("ignores non-http URLs", () => {
    const open = vi.fn();
    requestChatHttpLink("javascript:alert(1)", open);
    expect(open).not.toHaveBeenCalled();
    expect(getPendingChatExternalLink()).toBeNull();
  });
});

describe("confirm and dismiss", () => {
  it("opens on confirm and clears the prompt", () => {
    const open = vi.fn();
    requestChatHttpLink("https://example.com/a", open);
    confirmChatExternalLinkOpen();
    expect(open).toHaveBeenCalledTimes(1);
    expect(getPendingChatExternalLink()).toBeNull();
  });

  it("remembers the host when confirming with trustHost", () => {
    const first = vi.fn();
    const second = vi.fn();
    requestChatHttpLink("https://example.com/a", first);
    confirmChatExternalLinkOpen({ trustHost: true });
    expect(first).toHaveBeenCalledTimes(1);
    requestChatHttpLink("https://example.com/b", second);
    expect(second).toHaveBeenCalledTimes(1);
    expect(getPendingChatExternalLink()).toBeNull();
  });

  it("does not open on dismiss", () => {
    const open = vi.fn();
    requestChatHttpLink("https://example.com/a", open);
    dismissChatExternalLinkPrompt();
    expect(open).not.toHaveBeenCalled();
    expect(getPendingChatExternalLink()).toBeNull();
  });
});
