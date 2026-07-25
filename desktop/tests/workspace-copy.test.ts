import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  COPY_MAX_TOTAL_BYTES,
  copySourceIntoWorkspace,
  diffSessionWorkspaceCopy,
} from "../electron/workspace-mounts";

function tempDirs() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agx-ws-copy-"));
  const source = path.join(root, "source");
  const defaultDir = path.join(root, "default");
  fs.mkdirSync(source);
  fs.mkdirSync(defaultDir);
  return { root, source, defaultDir };
}

describe("workspace copy + diff", () => {
  it("detects modified files in the copy", async () => {
    const { root, source, defaultDir } = tempDirs();
    try {
      fs.writeFileSync(path.join(source, "a.txt"), "one\n", "utf8");
      const copied = await copySourceIntoWorkspace({
        defaultDir,
        source,
        destName: "source",
      });
      expect(copied.ok).toBe(true);
      fs.writeFileSync(path.join(defaultDir, "source", "a.txt"), "two\n", "utf8");
      // Ensure mtime differs from baseline.
      const st = fs.statSync(path.join(defaultDir, "source", "a.txt"));
      fs.utimesSync(path.join(defaultDir, "source", "a.txt"), st.atime, new Date(st.mtimeMs + 2000));

      const diff = await diffSessionWorkspaceCopy({ defaultDir, name: "source" });
      expect(diff.ok).toBe(true);
      expect(diff.modified).toContain("a.txt");
      expect(diff.added).toEqual([]);
      expect(diff.deleted).toEqual([]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("marks source_drifted when source changes after copy", async () => {
    const { root, source, defaultDir } = tempDirs();
    try {
      fs.writeFileSync(path.join(source, "a.txt"), "one\n", "utf8");
      const copied = await copySourceIntoWorkspace({
        defaultDir,
        source,
        destName: "source",
      });
      expect(copied.ok).toBe(true);
      fs.writeFileSync(path.join(source, "a.txt"), "changed\n", "utf8");
      const st = fs.statSync(path.join(source, "a.txt"));
      fs.utimesSync(path.join(source, "a.txt"), st.atime, new Date(st.mtimeMs + 2000));

      const diff = await diffSessionWorkspaceCopy({ defaultDir, name: "source" });
      expect(diff.ok).toBe(true);
      expect(diff.source_drifted).toBe(true);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("skips .git and node_modules", async () => {
    const { root, source, defaultDir } = tempDirs();
    try {
      fs.mkdirSync(path.join(source, ".git"));
      fs.writeFileSync(path.join(source, ".git", "config"), "x", "utf8");
      fs.mkdirSync(path.join(source, "node_modules"));
      fs.writeFileSync(path.join(source, "node_modules", "pkg.js"), "x", "utf8");
      fs.writeFileSync(path.join(source, "keep.txt"), "ok", "utf8");

      const copied = await copySourceIntoWorkspace({
        defaultDir,
        source,
        destName: "source",
      });
      expect(copied.ok).toBe(true);
      expect(fs.existsSync(path.join(defaultDir, "source", "keep.txt"))).toBe(true);
      expect(fs.existsSync(path.join(defaultDir, "source", ".git"))).toBe(false);
      expect(fs.existsSync(path.join(defaultDir, "source", "node_modules"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects copies over the size limit", async () => {
    const { root, source, defaultDir } = tempDirs();
    try {
      expect(COPY_MAX_TOTAL_BYTES).toBe(200 * 1024 * 1024);
      fs.writeFileSync(path.join(source, "big.txt"), "0123456789", "utf8");
      const copied = await copySourceIntoWorkspace({
        defaultDir,
        source,
        destName: "source",
        maxTotalBytes: 5,
      });
      expect(copied.ok).toBe(false);
      expect(copied.error || "").toContain("size limit (5 bytes)");
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
