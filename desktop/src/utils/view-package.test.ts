import { describe, expect, it } from "vitest";
import {
  framesFromManifest,
  joinPackagePath,
  parseViewPackageManifest,
  planViewPackage,
  VIEW_PACKAGE_FORMAT,
} from "./view-package";

describe("planViewPackage", () => {
  it("keeps files under their shared directory and records frame layout", () => {
    const planned = planViewPackage(
      [
        {
          id: "page-dashboard",
          title: "项目总览",
          absolutePath: "/work/bid/pages/dashboard.html",
          device: "desktop",
          x: 0,
          y: 40,
        },
        {
          id: "page-intake",
          title: "文件归集",
          absolutePath: "/work/bid/pages/intake.html",
          device: "tablet",
          x: 1600,
          y: 40,
        },
      ],
      { name: "bidding-eval-system" },
    );
    expect(planned.manifest.format).toBe(VIEW_PACKAGE_FORMAT);
    expect(planned.manifest.name).toBe("bidding-eval-system");
    expect(planned.entries.map((entry) => entry.zipName)).toEqual([
      "pages/dashboard.html",
      "pages/intake.html",
    ]);
    expect(planned.manifest.pages[1]).toMatchObject({
      id: "page-intake",
      file: "pages/intake.html",
      device: "tablet",
      x: 1600,
      y: 40,
    });
  });

  it("renames colliding basenames when files do not share a directory", () => {
    const planned = planViewPackage([
      {
        id: "a",
        title: "A",
        absolutePath: "/one/dashboard.html",
        device: "desktop",
        x: 0,
        y: 0,
      },
      {
        id: "b",
        title: "B",
        absolutePath: "/two/dashboard.html",
        device: "desktop",
        x: 10,
        y: 0,
      },
    ]);
    expect(planned.entries.map((entry) => entry.zipName)).toEqual([
      "dashboard.html",
      "dashboard-2.html",
    ]);
  });
});

describe("parseViewPackageManifest", () => {
  it("restores frames inside the extracted root and rejects path escape", () => {
    const manifest = parseViewPackageManifest({
      name: "bidding",
      version: "1.0.0",
      format: VIEW_PACKAGE_FORMAT,
      pages: [{ id: "page-dashboard", file: "pages/dashboard.html", title: "项目总览", device: "desktop", x: 12, y: 8 }],
    });
    expect(framesFromManifest(manifest, "/tmp/case")).toEqual([
      {
        id: "page-dashboard",
        title: "项目总览",
        absolutePath: "/tmp/case/pages/dashboard.html",
        device: "desktop",
        kind: "html",
        x: 12,
        y: 8,
      },
    ]);
    expect(() => joinPackagePath("/tmp/case", "../secret.html")).toThrow(/escapes/);
  });

  it("rejects an unknown format", () => {
    expect(() => parseViewPackageManifest({ format: "other", pages: [] })).toThrow(/unsupported/);
  });
});
