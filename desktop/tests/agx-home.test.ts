import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  clearDataRootPointer,
  defaultAgenticxHomeDir,
  expandAgxVirtualPath,
  refreshAgxHomeCache,
  resolveAgxHomeDir,
  writeDataRootPointer,
} from "../electron/agx-home";

describe("agx-home resolution", () => {
  let tmpHome: string;
  let prevHome: string | undefined;
  let prevUserProfile: string | undefined;
  let prevAgxHome: string | undefined;
  let prevAgenticxHome: string | undefined;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agx-home-test-"));
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    prevAgxHome = process.env.AGX_HOME;
    prevAgenticxHome = process.env.AGENTICX_HOME;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    delete process.env.AGX_HOME;
    delete process.env.AGENTICX_HOME;
    refreshAgxHomeCache();
  });

  afterEach(() => {
    refreshAgxHomeCache();
    if (prevHome === undefined) delete process.env.HOME;
    else process.env.HOME = prevHome;
    if (prevUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = prevUserProfile;
    if (prevAgxHome === undefined) delete process.env.AGX_HOME;
    else process.env.AGX_HOME = prevAgxHome;
    if (prevAgenticxHome === undefined) delete process.env.AGENTICX_HOME;
    else process.env.AGENTICX_HOME = prevAgenticxHome;
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("defaults to ~/.agenticx when unset", () => {
    expect(resolveAgxHomeDir()).toBe(defaultAgenticxHomeDir());
  });

  it("prefers AGX_HOME over pointer", () => {
    const envDir = path.join(tmpHome, "env-root");
    const pointerDir = path.join(tmpHome, "pointer-root");
    fs.mkdirSync(envDir);
    fs.mkdirSync(pointerDir);
    writeDataRootPointer(pointerDir);
    process.env.AGX_HOME = envDir;
    refreshAgxHomeCache();
    expect(resolveAgxHomeDir()).toBe(path.resolve(envDir));
  });

  it("reads bootstrap pointer when env unset", () => {
    const pointerDir = path.join(tmpHome, "pointer-root");
    fs.mkdirSync(pointerDir);
    writeDataRootPointer(pointerDir);
    refreshAgxHomeCache();
    expect(resolveAgxHomeDir()).toBe(path.resolve(pointerDir));
  });

  it("clears pointer back to default", () => {
    const pointerDir = path.join(tmpHome, "pointer-root");
    fs.mkdirSync(pointerDir);
    writeDataRootPointer(pointerDir);
    clearDataRootPointer();
    refreshAgxHomeCache();
    expect(resolveAgxHomeDir()).toBe(defaultAgenticxHomeDir());
  });

  it("expandAgxVirtualPath maps ~/.agenticx to the resolved data root", () => {
    const custom = path.join(tmpHome, "custom-data");
    fs.mkdirSync(custom);
    writeDataRootPointer(custom);
    refreshAgxHomeCache();
    expect(expandAgxVirtualPath("~/.agenticx/sessions/s1/messages.json")).toBe(
      path.join(custom, "sessions", "s1", "messages.json"),
    );
    expect(expandAgxVirtualPath("~/Documents/x.txt")).toBe(path.join(tmpHome, "Documents", "x.txt"));
  });
});
