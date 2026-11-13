import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applyConfiguredDataDir,
  clearDataRootPointer,
  dataRootPointerPath,
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
  /** Real-profile pointer path (computed before HOME redirect). Must stay untouched. */
  let realPointerPath: string;
  let realPointerSnapshot: string | null;

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agx-home-test-"));
    prevHome = process.env.HOME;
    prevUserProfile = process.env.USERPROFILE;
    prevAgxHome = process.env.AGX_HOME;
    prevAgenticxHome = process.env.AGENTICX_HOME;
    const realHome = prevHome || prevUserProfile || os.homedir();
    realPointerPath = path.join(realHome, ".agenticx", "data_root.json");
    realPointerSnapshot = fs.existsSync(realPointerPath)
      ? fs.readFileSync(realPointerPath, "utf-8")
      : null;
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome;
    delete process.env.AGX_HOME;
    delete process.env.AGENTICX_HOME;
    refreshAgxHomeCache();
  });

  afterEach(() => {
    refreshAgxHomeCache();
    // Defense in depth: never leave the real profile pointer dirty even if a
    // future regression re-introduces import-time path freezing.
    const after = fs.existsSync(realPointerPath)
      ? fs.readFileSync(realPointerPath, "utf-8")
      : null;
    if (after !== realPointerSnapshot) {
      if (realPointerSnapshot === null) {
        try {
          fs.unlinkSync(realPointerPath);
        } catch {
          /* best-effort */
        }
      } else {
        fs.mkdirSync(path.dirname(realPointerPath), { recursive: true });
        fs.writeFileSync(realPointerPath, realPointerSnapshot, "utf-8");
      }
    }
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

  it("writes pointer under redirected HOME, never the real user profile", () => {
    const custom = path.join(tmpHome, "custom-data");
    fs.mkdirSync(custom);
    writeDataRootPointer(custom);
    const isolatedPointer = path.join(tmpHome, ".agenticx", "data_root.json");
    expect(dataRootPointerPath()).toBe(isolatedPointer);
    expect(fs.existsSync(isolatedPointer)).toBe(true);
    const payload = JSON.parse(fs.readFileSync(isolatedPointer, "utf-8")) as { data_dir: string };
    expect(payload.data_dir).toBe(path.resolve(custom));
    const realAfter = fs.existsSync(realPointerPath)
      ? fs.readFileSync(realPointerPath, "utf-8")
      : null;
    expect(realAfter).toBe(realPointerSnapshot);
  });

  it("applyConfiguredDataDir also stays inside redirected HOME", () => {
    const custom = path.join(tmpHome, "custom-data-apply");
    fs.mkdirSync(custom);
    const applied = applyConfiguredDataDir(custom);
    expect(applied.ok).toBe(true);
    expect(fs.existsSync(path.join(tmpHome, ".agenticx", "data_root.json"))).toBe(true);
    const realAfter = fs.existsSync(realPointerPath)
      ? fs.readFileSync(realPointerPath, "utf-8")
      : null;
    expect(realAfter).toBe(realPointerSnapshot);
  });
});
