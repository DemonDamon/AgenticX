import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isRealpathUnder, safeRealpath } from "../electron/path-guard";

describe("path-guard", () => {
  it("does not treat /a/bc as under /a/b (prefix false positive)", async () => {
    const root = await safeRealpath("/a/b");
    // Even when paths don't exist, safeRealpath returns a normalized absolute form.
    const child = await safeRealpath("/a/bc");
    // Direct string check on canonicalized forms mirrors isRealpathUnder.
    expect(child === root || child.startsWith(root + path.sep)).toBe(false);
    expect(await isRealpathUnder("/a/bc", "/a/b")).toBe(false);
  });

  it("resolves through a symlink directory", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agx-path-guard-"));
    try {
      const real = path.join(tmp, "real");
      const link = path.join(tmp, "link");
      fs.mkdirSync(real);
      fs.mkdirSync(path.join(real, "c"));
      fs.symlinkSync(real, link, "dir");
      expect(await isRealpathUnder(path.join(link, "c"), real)).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("tolerates a non-existent leaf", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agx-path-guard-"));
    try {
      const missing = path.join(tmp, "nope", "leaf.txt");
      const real = await safeRealpath(missing);
      expect(real.endsWith(path.join("nope", "leaf.txt"))).toBe(true);
      expect(real.startsWith(await safeRealpath(tmp))).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("treats /tmp and /private/tmp as the same root on macOS", async () => {
    if (process.platform !== "darwin") return;
    const a = path.join("/tmp", "agx-path-guard-foo");
    const b = path.join("/private/tmp", "agx-path-guard-foo");
    expect(await isRealpathUnder(a, "/private/tmp")).toBe(true);
    expect(await isRealpathUnder(b, "/tmp")).toBe(true);
  });
});
