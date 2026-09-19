import { describe, expect, it } from "vitest";
import {
  DEFAULT_META_AVATAR_URL,
  isBundledMetaAvatarUrl,
  resolveBundledMetaAvatarUrl,
} from "./meta-avatar";

describe("isBundledMetaAvatarUrl", () => {
  it("matches the bundled default URL", () => {
    expect(isBundledMetaAvatarUrl(DEFAULT_META_AVATAR_URL)).toBe(true);
    expect(DEFAULT_META_AVATAR_URL).toMatch(/export_embedded/);
  });

  it("matches hashed and file-path variants of the bundled mark", () => {
    expect(isBundledMetaAvatarUrl("/assets/near-cube-mark-ab12cd.svg")).toBe(true);
    expect(isBundledMetaAvatarUrl("file:///tmp/near-cube-mark.svg")).toBe(true);
    expect(isBundledMetaAvatarUrl("/assets/export_embedded-ab12cd.png")).toBe(true);
    expect(isBundledMetaAvatarUrl("file:///tmp/export_embedded.png")).toBe(true);
  });

  it("does not treat expert portraits as the bundled mark", () => {
    expect(isBundledMetaAvatarUrl("https://example.test/architect.png")).toBe(false);
    expect(isBundledMetaAvatarUrl("")).toBe(false);
    expect(isBundledMetaAvatarUrl(undefined)).toBe(false);
  });

  it("upgrades the leftover dual-orange SVG to the official PNG", () => {
    expect(resolveBundledMetaAvatarUrl("/assets/near-cube-mark-ab12cd.svg")).toBe(
      DEFAULT_META_AVATAR_URL,
    );
    expect(resolveBundledMetaAvatarUrl("/assets/export_embedded-ab12cd.png")).toBe(
      DEFAULT_META_AVATAR_URL,
    );
    expect(resolveBundledMetaAvatarUrl("https://example.test/architect.png")).toBe(
      "https://example.test/architect.png",
    );
  });
});
