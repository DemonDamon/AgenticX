import { describe, expect, it } from "vitest";
import { canTransitionCase, casePageFile } from "../case-status";

describe("case library transitions", () => {
  it("requires review and archive before a case is published", () => {
    expect(canTransitionCase("submitted", "reviewing")).toBe(true);
    expect(canTransitionCase("submitted", "published")).toBe(false);
    expect(canTransitionCase("reviewing", "archived")).toBe(true);
    expect(canTransitionCase("reviewing", "submitted")).toBe(true);
    expect(canTransitionCase("archived", "published")).toBe(true);
    expect(canTransitionCase("published", "archived")).toBe(false);
  });

  it("only allows preview of a page listed in the manifest", () => {
    const manifest = {
      format: "agx-view-package/1",
      pages: [{ file: "pages/dashboard.html" }],
    };
    expect(casePageFile(manifest, "pages/dashboard.html")).toBe("pages/dashboard.html");
    expect(casePageFile(manifest, "../secret.html")).toBeNull();
    expect(casePageFile(manifest, "pages/other.html")).toBeNull();
  });
});
