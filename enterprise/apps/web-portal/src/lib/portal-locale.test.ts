import { describe, expect, it } from "vitest";
import { localeFromCookieValue } from "./portal-locale";

describe("localeFromCookieValue", () => {
  it("accepts zh and en", () => {
    expect(localeFromCookieValue("en")).toBe("en");
    expect(localeFromCookieValue("zh")).toBe("zh");
  });

  it("falls back to zh for missing or garbage values", () => {
    expect(localeFromCookieValue(undefined)).toBe("zh");
    expect(localeFromCookieValue(null)).toBe("zh");
    expect(localeFromCookieValue("fr")).toBe("zh");
  });
});
