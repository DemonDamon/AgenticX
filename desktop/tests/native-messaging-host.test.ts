/**
 * SP6 unit tests — NM host installer engineering (electron/native-messaging-host.ts).
 *
 * Covers the pure builders (manifest object, POSIX/Windows wrapper scripts,
 * reg.exe command arrays) and the idempotent dev/installed installation on
 * POSIX via an os.homedir() stub. Windows registry EXECUTION is only covered
 * at the command-construction level: the dev machine is macOS, so reg.exe
 * behavior (verified against the Chrome NM docs: HKCU default value = JSON
 * manifest path, per-user, /f overwrite) is honestly UNVERIFIED at runtime —
 * see the module header note in native-messaging-host.ts.
 *
 * Author: Damon Li
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  NM_HOST_NAME,
  buildNmHostManifest,
  buildPosixWrapperScript,
  buildWindowsWrapperScript,
  installNmHost,
  nmHostManifestPathFor,
  nmHostManifestPathWindows,
  nmHostWrapperPath,
  nmHostWrapperPathWindows,
  uninstallNmHost,
  windowsRegistryAddCommands,
  windowsRegistryDeleteCommands,
} from "../electron/native-messaging-host";

describe("SP6 NM host installer · pure builders", () => {
  it("builds the NM host manifest for the fixed extension origin", () => {
    const manifest = buildNmHostManifest("kajgkmohjdflaidencpfmebbjibfieka", "/Users/x/.agenticx/agx-nm-bridge-host.sh");
    expect(manifest).toEqual({
      name: NM_HOST_NAME,
      description: "AgenticX browser extension bridge",
      path: "/Users/x/.agenticx/agx-nm-bridge-host.sh",
      type: "stdio",
      allowed_origins: ["chrome-extension://kajgkmohjdflaidencpfmebbjibfieka/"],
    });
  });

  it("dev wrapper execs a system node on the shim", () => {
    const script = buildPosixWrapperScript({
      mode: "dev",
      nodeBinary: "/opt/homebrew/bin/node",
      electronBinary: "/Applications/Near.app/Contents/MacOS/Near",
      shimPath: "/repo/scripts/nm-bridge-shim.mjs",
    });
    expect(script).toBe(
      '#!/bin/sh\nexec "/opt/homebrew/bin/node" "/repo/scripts/nm-bridge-shim.mjs" "$@"\n',
    );
  });

  it("installed wrapper reuses the packaged app binary as node", () => {
    const script = buildPosixWrapperScript({
      mode: "installed",
      nodeBinary: "/opt/homebrew/bin/node",
      electronBinary: "/Applications/Near.app/Contents/MacOS/Near",
      shimPath: "/Applications/Near.app/Contents/Resources/extension-host/nm-bridge-shim.mjs",
    });
    expect(script).toBe(
      "#!/bin/sh\n" +
        'exec env ELECTRON_RUN_AS_NODE=1 "/Applications/Near.app/Contents/MacOS/Near" ' +
        '"/Applications/Near.app/Contents/Resources/extension-host/nm-bridge-shim.mjs" "$@"\n',
    );
  });

  it("windows wrapper is CRLF .cmd with ELECTRON_RUN_AS_NODE", () => {
    const script = buildWindowsWrapperScript({
      mode: "installed",
      nodeBinary: "C:\\Program Files\\nodejs\\node.exe",
      electronBinary: 'C:\\Users\\x\\AppData\\Local\\Programs\\Near\\Near.exe',
      shimPath: "C:\\Users\\x\\AppData\\Local\\Programs\\Near\\resources\\extension-host\\nm-bridge-shim.mjs",
    });
    expect(script.split("\r\n")).toEqual([
      "@echo off",
      "set ELECTRON_RUN_AS_NODE=1",
      '"C:\\Users\\x\\AppData\\Local\\Programs\\Near\\Near.exe" ' +
        '"C:\\Users\\x\\AppData\\Local\\Programs\\Near\\resources\\extension-host\\nm-bridge-shim.mjs" %*',
      "",
    ]);
  });

  it("registry add commands write the manifest path as the HKCU default value", () => {
    expect(windowsRegistryAddCommands("C:\\x\\nm-hosts\\com.agenticx.bridge.json", ["chrome"])).toEqual([
      [
        "add",
        "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.agenticx.bridge",
        "/ve",
        "/t",
        "REG_SZ",
        "/d",
        "C:\\x\\nm-hosts\\com.agenticx.bridge.json",
        "/f",
      ],
    ]);
    expect(windowsRegistryAddCommands("C:\\x\\m.json", ["edge"])[0][1]).toBe(
      "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts\\com.agenticx.bridge",
    );
  });

  it("registry delete commands target the same keys", () => {
    expect(windowsRegistryDeleteCommands(["chrome", "chromium"])).toEqual([
      ["delete", "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.agenticx.bridge", "/f"],
      ["delete", "HKCU\\Software\\Chromium\\NativeMessagingHosts\\com.agenticx.bridge", "/f"],
    ]);
  });
});

describe("SP6 NM host installer · dev/installed install (POSIX)", () => {
  let tmpHome: string;
  let tmpShim: string;
  // NOTE: deliberately NOT mockRestore()-ed — vitest 4 detaches a spy on
  // restore and later mockReturnValue() calls become silent no-ops (verified
  // via a probe run), which would let these tests write into the REAL home.
  const homedirSpy = vi.spyOn(os, "homedir");

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agx-nm-host-test-"));
    tmpShim = path.join(tmpHome, "nm-bridge-shim.mjs");
    fs.writeFileSync(tmpShim, "// shim stub\n", "utf-8");
    homedirSpy.mockReturnValue(tmpHome);
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("dev mode registers the wrapper + chrome manifest with the repo shim", () => {
    const nodeBinary = process.execPath;
    const installed = installNmHost({ mode: "dev", shimPath: tmpShim, nodeBinary });

    expect(installed.mode).toBe("dev");
    expect(installed.shimPath).toBe(tmpShim);
    expect(installed.runtime).toBe(nodeBinary);

    const wrapperPath = nmHostWrapperPath();
    expect(fs.readFileSync(wrapperPath, "utf-8")).toBe(
      `#!/bin/sh\nexec ${JSON.stringify(nodeBinary)} ${JSON.stringify(tmpShim)} "$@"\n`,
    );
    expect((fs.statSync(wrapperPath).mode & 0o111) !== 0).toBe(true); // executable

    const manifestPath = nmHostManifestPathFor("chrome");
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.name).toBe(NM_HOST_NAME);
    expect(manifest.path).toBe(wrapperPath);
    expect(manifest.type).toBe("stdio");
    expect(manifest.allowed_origins).toEqual(["chrome-extension://kajgkmohjdflaidencpfmebbjibfieka/"]);
  });

  it("installed mode points the wrapper at the packaged resources via ELECTRON_RUN_AS_NODE", () => {
    const electronBinary = "/Applications/Near.app/Contents/MacOS/Near";
    const installed = installNmHost({
      mode: "installed",
      shimPath: tmpShim,
      nodeBinary: process.execPath,
      electronBinary,
      browsers: ["chrome", "edge"],
    });

    expect(installed.mode).toBe("installed");
    expect(installed.runtime).toBe(electronBinary);
    expect(fs.readFileSync(nmHostWrapperPath(), "utf-8")).toBe(
      `#!/bin/sh\nexec env ELECTRON_RUN_AS_NODE=1 ${JSON.stringify(electronBinary)} ${JSON.stringify(tmpShim)} "$@"\n`,
    );
    // Both browser manifests got the same registration.
    for (const browser of ["chrome", "edge"] as const) {
      const manifest = JSON.parse(fs.readFileSync(nmHostManifestPathFor(browser), "utf-8"));
      expect(manifest.path).toBe(nmHostWrapperPath());
    }
  });

  it("re-running an install is idempotent (same bytes, no error)", () => {
    const options = { mode: "dev" as const, shimPath: tmpShim, nodeBinary: process.execPath };
    installNmHost(options);
    const before = fs.readFileSync(nmHostWrapperPath(), "utf-8");
    installNmHost(options);
    expect(fs.readFileSync(nmHostWrapperPath(), "utf-8")).toBe(before);
  });

  it("uninstall removes wrapper + manifests across browsers", () => {
    installNmHost({
      mode: "dev",
      shimPath: tmpShim,
      nodeBinary: process.execPath,
      browsers: ["chrome", "edge", "chromium"],
    });
    uninstallNmHost(["chrome", "edge", "chromium"]);
    for (const file of [
      nmHostWrapperPath(),
      nmHostWrapperPathWindows(),
      nmHostManifestPathWindows(),
      nmHostManifestPathFor("chrome"),
      nmHostManifestPathFor("edge"),
      nmHostManifestPathFor("chromium"),
    ]) {
      expect(fs.existsSync(file)).toBe(false);
    }
  });

  it("fails fast when the shim is missing", () => {
    expect(() =>
      installNmHost({ mode: "dev", shimPath: path.join(tmpHome, "missing.mjs") }),
    ).toThrowError(/shim not found/);
  });
});

describe("SP6 NM host installer · windows install (command level)", () => {
  let tmpHome: string;
  let tmpShim: string;
  // Same no-restore note as the POSIX suite above (vitest 4 spy detach).
  const homedirSpy = vi.spyOn(os, "homedir");

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "agx-nm-host-win-test-"));
    tmpShim = path.join(tmpHome, "nm-bridge-shim.mjs");
    fs.writeFileSync(tmpShim, "// shim stub\n", "utf-8");
    homedirSpy.mockReturnValue(tmpHome);
  });

  afterEach(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("writes the .cmd wrapper + manifest and runs the exact reg.exe commands", () => {
    // Force the win32 branch without a real Windows box; reg.exe execution is
    // intercepted, so this stays a pure logic assertion (see file header).
    const platformSpy = vi.spyOn(process, "platform", "get").mockReturnValue("win32" as NodeJS.Platform);
    const registryCommands: string[][] = [];
    try {
      installNmHost({
        mode: "installed",
        shimPath: tmpShim,
        nodeBinary: "C:\\node\\node.exe",
        electronBinary: "C:\\Apps\\Near\\Near.exe",
        browsers: ["chrome"],
        runRegistryCommand: (args) => registryCommands.push(args),
      });
    } finally {
      platformSpy.mockRestore();
    }

    const wrapper = fs.readFileSync(nmHostWrapperPathWindows(), "utf-8");
    expect(wrapper).toContain("set ELECTRON_RUN_AS_NODE=1");
    expect(wrapper).toContain('"C:\\Apps\\Near\\Near.exe"');
    expect(wrapper).toContain("%*");

    const manifestPath = nmHostManifestPathWindows();
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
    expect(manifest.path).toBe(nmHostWrapperPathWindows());

    expect(registryCommands).toEqual(windowsRegistryAddCommands(manifestPath, ["chrome"]));
  });
});
