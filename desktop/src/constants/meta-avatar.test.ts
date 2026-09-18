import { describe, expect, it } from "vitest";
import {
  DEFAULT_META_AVATAR_URL,
  isBundledMetaAvatarUrl,
} from "./meta-avatar";

describe("isBundledMetaAvatarUrl", () => {
  it("matches the bundled default URL", () => {
    expect(isBundledMetaAvatarUrl(DEFAULT_META_AVATAR_URL)).toBe(true);
  });

  it("matches hashed and file-path variants of the bundled mark", () => {
    expect(isBundledMetaAvatarUrl("/assets/export_embedded-ab12cd.png")).toBe(true);
    expect(isBundledMetaAvatarUrl("file:///tmp/export_embedded.png")).toBe(true);
  });

  it("does not treat expert portraits as the bundled mark", () => {
    expect(isBundledMetaAvatarUrl("https://example.test/architect.png")).toBe(false);
    expect(isBundledMetaAvatarUrl("")).toBe(false);
    expect(isBundledMetaAvatarUrl(undefined)).toBe(false);
  });
});
