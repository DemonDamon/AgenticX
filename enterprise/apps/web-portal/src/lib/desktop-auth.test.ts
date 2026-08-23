import { describe, expect, it, vi } from "vitest";

vi.mock("@agenticx/iam-core", () => ({
  getAdminUser: vi.fn(),
  touchPatLastUsed: vi.fn(),
  verifyPat: vi.fn(),
}));

import { DESKTOP_MANAGED_PAT_SCOPES, desktopPatDisplayName } from "./desktop-auth";

describe("DESKTOP_MANAGED_PAT_SCOPES", () => {
  it("includes workspace:chat and desktop:managed for device tokens", () => {
    expect([...DESKTOP_MANAGED_PAT_SCOPES]).toEqual(["workspace:chat", "desktop:managed"]);
  });
});

describe("desktopPatDisplayName", () => {
  it("uses a neutral Desktop prefix", () => {
    expect(desktopPatDisplayName("MacBook")).toBe("Desktop · MacBook");
    expect(desktopPatDisplayName("  ")).toBe("Desktop · Desktop");
  });
});
