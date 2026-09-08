import { describe, expect, it } from "vitest";
import { htmlLangFor, isAppLocale } from "./locales";
import { localeFromOsTag, resolveAppLocale } from "./resolve-locale";

describe("isAppLocale", () => {
  it("accepts only zh and en", () => {
    expect(isAppLocale("zh")).toBe(true);
    expect(isAppLocale("en")).toBe(true);
    expect(isAppLocale("fr")).toBe(false);
    expect(isAppLocale("zh-CN")).toBe(false);
    expect(isAppLocale("")).toBe(false);
    expect(isAppLocale(null)).toBe(false);
    expect(isAppLocale(undefined)).toBe(false);
  });
});

describe("htmlLangFor", () => {
  it("maps app locales to html lang", () => {
    expect(htmlLangFor("en")).toBe("en");
    expect(htmlLangFor("zh")).toBe("zh-CN");
  });
});

describe("localeFromOsTag", () => {
  it("treats en* as English", () => {
    expect(localeFromOsTag("en-US")).toBe("en");
    expect(localeFromOsTag("en")).toBe("en");
    expect(localeFromOsTag("EN_us")).toBe("en");
    expect(localeFromOsTag("en-GB")).toBe("en");
  });

  it("treats everything else as Chinese", () => {
    expect(localeFromOsTag("zh-CN")).toBe("zh");
    expect(localeFromOsTag("zh-TW")).toBe("zh");
    expect(localeFromOsTag("ja-JP")).toBe("zh");
    expect(localeFromOsTag("")).toBe("zh");
    expect(localeFromOsTag(undefined)).toBe("zh");
  });
});

describe("resolveAppLocale", () => {
  it("prefers a saved en over any OS tag", () => {
    expect(resolveAppLocale({ saved: "en", osTag: "zh-CN" })).toBe("en");
    expect(resolveAppLocale({ saved: "en", osTag: "ja-JP" })).toBe("en");
  });

  it("prefers a saved zh over an English OS", () => {
    expect(resolveAppLocale({ saved: "zh", osTag: "en-US" })).toBe("zh");
  });

  it("ignores illegal saved values and falls back to OS", () => {
    expect(resolveAppLocale({ saved: "fr", osTag: "en-GB" })).toBe("en");
  });

  it("uses OS when nothing is saved", () => {
    expect(resolveAppLocale({ osTag: "en-US" })).toBe("en");
    expect(resolveAppLocale({ osTag: "en" })).toBe("en");
    expect(resolveAppLocale({ osTag: "EN_us" })).toBe("en");
    expect(resolveAppLocale({ osTag: "zh-CN" })).toBe("zh");
    expect(resolveAppLocale({ osTag: "zh-TW" })).toBe("zh");
    expect(resolveAppLocale({ osTag: "ja-JP" })).toBe("zh");
    expect(resolveAppLocale({ osTag: "" })).toBe("zh");
    expect(resolveAppLocale({ osTag: undefined })).toBe("zh");
    expect(resolveAppLocale({})).toBe("zh");
  });
});
