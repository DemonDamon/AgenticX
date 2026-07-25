import { describe, expect, it, vi } from "vitest";

import {
  createWorkspaceLink,
  symlinkTypeForDirectory,
} from "../electron/workspace-mounts";

describe("createWorkspaceLink", () => {
  it("uses junction type for directories on win32", async () => {
    const symlinkFn = vi.fn(async () => undefined);
    const result = await createWorkspaceLink({
      source: "/src/proj",
      dest: "/dest/proj",
      isDirectory: true,
      platform: "win32",
      symlinkFn: symlinkFn as unknown as typeof import("node:fs").promises.symlink,
    });
    expect(result.ok).toBe(true);
    expect(symlinkTypeForDirectory("win32")).toBe("junction");
    expect(symlinkFn).toHaveBeenCalled();
    const args = symlinkFn.mock.calls[0];
    expect(args?.[2]).toBe("junction");
    expect(String(args?.[1])).toContain("/dest/proj");
  });

  it("uses dir type for directories on darwin", async () => {
    const symlinkFn = vi.fn(async () => undefined);
    await createWorkspaceLink({
      source: "/src/proj",
      dest: "/dest/proj",
      isDirectory: true,
      platform: "darwin",
      symlinkFn: symlinkFn as unknown as typeof import("node:fs").promises.symlink,
    });
    expect(symlinkFn).toHaveBeenCalledWith("/src/proj", "/dest/proj", "dir");
  });

  it("reports failure when both symlink attempts throw", async () => {
    const symlinkFn = vi.fn(async () => {
      throw new Error("EPERM");
    });
    const result = await createWorkspaceLink({
      source: "/src/a",
      dest: "/dest/a",
      isDirectory: false,
      platform: "darwin",
      symlinkFn: symlinkFn as unknown as typeof import("node:fs").promises.symlink,
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("EPERM");
  });
});
