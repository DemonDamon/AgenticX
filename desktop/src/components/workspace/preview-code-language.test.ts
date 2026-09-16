import { describe, expect, it } from "vitest";
import { isIndentFoldLanguage, previewLanguageFromPath } from "./preview-code-language";

describe("previewLanguageFromPath", () => {
  it("maps common source extensions instead of falling back to clike", () => {
    expect(previewLanguageFromPath("/tmp/main.go")).toBe("go");
    expect(previewLanguageFromPath("/tmp/hello.py")).toBe("python");
    expect(previewLanguageFromPath("/tmp/app.ts")).toBe("typescript");
    expect(previewLanguageFromPath("/tmp/lib.rs")).toBe("rust");
    expect(previewLanguageFromPath("/tmp/main.c")).toBe("c");
    expect(previewLanguageFromPath("/tmp/notes.txt")).toBe("plaintext");
  });

  it("treats python/yaml as indent-fold languages", () => {
    expect(isIndentFoldLanguage("python")).toBe(true);
    expect(isIndentFoldLanguage("yaml")).toBe(true);
    expect(isIndentFoldLanguage("go")).toBe(false);
  });
});
