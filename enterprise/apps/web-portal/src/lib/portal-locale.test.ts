import { describe, expect, it } from "vitest";
import { resolveAppLocale } from "../i18n/routing";
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

describe("resolveAppLocale", () => {
  it("lets the cookie win over Accept-Language", () => {
    expect(resolveAppLocale("zh", "en-US,en;q=0.9")).toBe("zh");
    expect(resolveAppLocale("en", "zh-CN,zh;q=0.9")).toBe("en");
  });

  it("uses Accept-Language when the cookie is missing", () => {
    expect(resolveAppLocale(undefined, "en-US,en;q=0.9")).toBe("en");
    expect(resolveAppLocale(null, "en")).toBe("en");
  });

  it("defaults to zh when cookie and Accept-Language are both absent", () => {
    expect(resolveAppLocale(undefined, null)).toBe("zh");
    expect(resolveAppLocale("fr", "fr-FR")).toBe("zh");
  });
});
