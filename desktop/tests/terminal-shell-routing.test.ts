import { describe, expect, it, beforeEach } from "vitest";

import {
  isBridgeTerminalSessionId,
  registerShellTabPty,
  resolveNativeShellPtySessionId,
  resolveTabWriteSessionId,
  shellTabPtyByTabId,
  unregisterShellTabPtyForSession,
} from "../electron/terminal-shell-routing";

describe("terminal shell routing", () => {
  beforeEach(() => {
    shellTabPtyByTabId.clear();
  });

  it("detects bridge session ids", () => {
    expect(isBridgeTerminalSessionId("tab-1:bridge:uuid")).toBe(true);
    expect(isBridgeTerminalSessionId("tab-1:spawn-abc")).toBe(false);
  });

  it("prefers registered shell pty over bridge on the same tab", () => {
    const kinds = new Map<string, "pty" | "bridge">([
      ["tab-a:bridge:cc", "bridge"],
      ["tab-a:shell-1", "pty"],
    ]);
    registerShellTabPty("tab-a", "tab-a:shell-1");
    expect(resolveNativeShellPtySessionId("tab-a", kinds)).toBe("tab-a:shell-1");
  });

  it("never returns bridge when shellOnly is true", () => {
    const kinds = new Map<string, "pty" | "bridge">([["tab-a:bridge:cc", "bridge"]]);
    expect(resolveTabWriteSessionId("tab-a", kinds, true)).toBeNull();
  });

  it("prefers pty over bridge for generic tab writes", () => {
    const kinds = new Map<string, "pty" | "bridge">([
      ["tab-a:bridge:cc", "bridge"],
      ["tab-a:shell-1", "pty"],
    ]);
    expect(resolveTabWriteSessionId("tab-a", kinds, false)).toBe("tab-a:shell-1");
  });

  it("unregisters shell tab mapping on kill", () => {
    registerShellTabPty("tab-a", "tab-a:shell-1");
    unregisterShellTabPtyForSession("tab-a:shell-1");
    expect(shellTabPtyByTabId.has("tab-a")).toBe(false);
  });
});
