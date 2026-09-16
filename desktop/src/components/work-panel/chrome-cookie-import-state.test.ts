import { describe, expect, it } from "vitest";
import {
  parseChromeCookieImportState,
  shouldShowChromeCookieBanner,
} from "./chrome-cookie-import-state";

describe("parseChromeCookieImportState", () => {
  it("treats imported or dismissed as hidden", () => {
    expect(parseChromeCookieImportState(null)).toEqual({ dismissed: false });
    expect(parseChromeCookieImportState("not-json").dismissed).toBe(false);
    expect(parseChromeCookieImportState(JSON.stringify({ importedAt: 1 })).dismissed).toBe(true);
    expect(parseChromeCookieImportState(JSON.stringify({ dismissed: true })).dismissed).toBe(true);
  });
});

describe("shouldShowChromeCookieBanner", () => {
  it("shows only when Chrome profiles exist and user has not dismissed", () => {
    expect(shouldShowChromeCookieBanner({ dismissed: false }, 1)).toBe(true);
    expect(shouldShowChromeCookieBanner({ dismissed: true }, 1)).toBe(false);
    expect(shouldShowChromeCookieBanner({ dismissed: false }, 0)).toBe(false);
  });
});
