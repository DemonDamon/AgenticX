/**
 * SP1 spike → SP6 production: installs the Chrome Native Messaging host.
 *
 * Manifest format per
 * https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging:
 *   - macOS/Linux user-level manifest lives in
 *       ~/Library/Application Support/<Browser>/NativeMessagingHosts/<name>.json
 *     with fields name/description/path/type:"stdio"/allowed_origins, where
 *     path MUST be absolute. `allowed_origins` cannot contain wildcards, so
 *     the unpacked/CRX extension ID is locked via the fixed "key" field in
 *     extension/manifest.json (SP1 plan §5.1 records the key/ID pair).
 *   - Windows requires a registry key instead:
 *       HKCU\Software\Google\Chrome\NativeMessagingHosts\<name>
 *     whose DEFAULT value is the absolute path of the same manifest JSON
 *     (HKCU = per-user, no elevation needed; the SP1 TODO is repaid here).
 *
 * Two install modes (SP6 plan §1.1):
 *   - "dev":      shim = the in-repo scripts/nm-bridge-shim.mjs run by a real
 *                 system node (resolved via PATH/homebrew). Used by
 *                 scripts/install-extension-dev.sh AND by `npm run dev`.
 *   - "installed": shim = the copy bundled by the electron-builder afterPack
 *                 hook (desktop/scripts/pack-nm-host.js) into
 *                 <Resources>/extension-host/nm-bridge-shim.mjs, executed via
 *                 the packaged app binary with ELECTRON_RUN_AS_NODE=1 (no
 *                 system node dependency on end-user machines).
 *
 * Registration is idempotent (files are overwritten, registry /f), so it is
 * safe to run on every desktop boot — the Bitwarden-style "app owns its NM
 * host registration" posture (a DMG cannot run install-time scripts, the
 * first app launch registers the host).
 *
 * Mountable from electron/main.ts (wired next to startNearBrowserBridge):
 *
 *   import { installNmHost } from "./native-messaging-host";
 *   installNmHost({ mode: app.isPackaged ? "installed" : "dev" });
 *
 * Windows registry execution NOTE: implemented + unit-tested at the command
 * construction level; NOT runtime-verified on this macOS dev machine (the
 * vitest suite asserts the reg.exe argv arrays verbatim — see
 * desktop/tests/native-messaging-host.test.ts).
 *
 * Author: Damon Li
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const NM_HOST_NAME = "com.agenticx.bridge";
/** Locked by the fixed "key" in extension/manifest.json — value recorded in the SP1 plan. */
export const SPIKE_EXTENSION_ID = "kajgkmohjdflaidencpfmebbjibfieka";

export type NmHostInstallMode = "dev" | "installed";

/** Browsers whose NativeMessagingHosts dirs / registry keys we register. */
export type NmBrowser = "chrome" | "edge" | "chromium";

const MACOS_BROWSER_DIRS: Record<NmBrowser, string[]> = {
  chrome: ["Library", "Application Support", "Google", "Chrome", "NativeMessagingHosts"],
  edge: ["Library", "Application Support", "Microsoft", "Edge", "NativeMessagingHosts"],
  chromium: ["Library", "Application Support", "Chromium", "NativeMessagingHosts"],
};

const WINDOWS_REGISTRY_ROOTS: Record<NmBrowser, string> = {
  chrome: "HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts",
  edge: "HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts",
  chromium: "HKCU\\Software\\Chromium\\NativeMessagingHosts",
};

export function nmHostWrapperPath(): string {
  return path.join(os.homedir(), ".agenticx", "agx-nm-bridge-host.sh");
}

export function nmHostWrapperPathWindows(): string {
  return path.join(os.homedir(), ".agenticx", "agx-nm-bridge-host.cmd");
}

/** Windows manifest location (registry default value points here). */
export function nmHostManifestPathWindows(): string {
  return path.join(os.homedir(), ".agenticx", "nm-hosts", `${NM_HOST_NAME}.json`);
}

/** macOS/Linux user-level manifest location for one browser. */
export function nmHostManifestPathFor(browser: NmBrowser = "chrome"): string {
  const segments = MACOS_BROWSER_DIRS[browser];
  if (!segments) throw new Error(`unsupported browser: ${browser}`);
  return path.join(os.homedir(), ...segments, `${NM_HOST_NAME}.json`);
}

/**
 * Back-compat alias for the SP1 name (chrome manifest on macOS) —
 * install-extension-dev.sh and the e2e harness keep using it.
 */
export function nmHostManifestPath(): string {
  return nmHostManifestPathFor("chrome");
}

/** electron/*.ts compiles to dist-electron/*.js → repo root is two levels up. */
function defaultDevShimPath(): string {
  return path.resolve(__dirname, "..", "..", "scripts", "nm-bridge-shim.mjs");
}

/** Bundled shim inside the packaged app resources (afterPack hook destination). */
function defaultInstalledShimPath(): string {
  const resourcesPath =
    typeof process !== "undefined" && (process as { resourcesPath?: string }).resourcesPath;
  if (!resourcesPath) {
    throw new Error("installed mode requires Electron's process.resourcesPath");
  }
  return path.join(resourcesPath, "extension-host", "nm-bridge-shim.mjs");
}

function resolveNodeBinary(): string {
  const versions = process.versions as Record<string, string | undefined>;
  if (!versions.electron) {
    // Running under a plain node process (e.g. manual tooling).
    return process.execPath;
  }
  // Inside Electron, process.execPath is the app binary — prefer a real node.
  const candidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node"];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  try {
    const which = execFileSync("bash", ["-lc", "command -v node"], { encoding: "utf8" }).trim();
    if (which) {
      return which;
    }
  } catch {
    /* fall through */
  }
  return candidates[0];
}

// ---------------------------------------------------------------------------
// Pure builders — unit-tested without touching the filesystem/registry.
// ---------------------------------------------------------------------------

export type NmHostManifestObject = {
  name: string;
  description: string;
  path: string;
  type: "stdio";
  allowed_origins: string[];
};

/** The NM host manifest JSON object for one extension origin + host path. */
export function buildNmHostManifest(extensionId: string, hostPath: string): NmHostManifestObject {
  return {
    name: NM_HOST_NAME,
    description: "AgenticX browser extension bridge",
    path: hostPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
}

/**
 * POSIX wrapper: exec's the runtime on the shim. dev mode uses a system
 * node; installed mode reuses the packaged Electron binary as node
 * (ELECTRON_RUN_AS_NODE=1 — official Electron feature, no system node
 * dependency on end-user machines).
 */
export function buildPosixWrapperScript(host: {
  mode: NmHostInstallMode;
  nodeBinary: string;
  electronBinary: string;
  shimPath: string;
}): string {
  if (host.mode === "installed") {
    return [
      "#!/bin/sh",
      `exec env ELECTRON_RUN_AS_NODE=1 ${JSON.stringify(host.electronBinary)} ${JSON.stringify(host.shimPath)} "$@"`,
      "",
    ].join("\n");
  }
  return `#!/bin/sh\nexec ${JSON.stringify(host.nodeBinary)} ${JSON.stringify(host.shimPath)} "$@"\n`;
}

/** Windows .cmd wrapper (dev/installed carry the same ELECTRON_RUN_AS_NODE env). */
export function buildWindowsWrapperScript(host: {
  mode: NmHostInstallMode;
  nodeBinary: string;
  electronBinary: string;
  shimPath: string;
}): string {
  const runtime =
    host.mode === "installed" ? host.electronBinary.replace(/"/g, '""') : host.nodeBinary.replace(/"/g, '""');
  const shim = host.shimPath.replace(/"/g, '""');
  return [
    "@echo off",
    "set ELECTRON_RUN_AS_NODE=1",
    `"${runtime}" "${shim}" %*`,
    "",
  ].join("\r\n");
}

/**
 * reg.exe commands registering the manifest path for each browser under
 * HKCU (per-user, no elevation). /ve writes the DEFAULT value; /f overwrites.
 */
export function windowsRegistryAddCommands(
  manifestPath: string,
  browsers: NmBrowser[] = ["chrome"],
): string[][] {
  return browsers.map((browser) => [
    "add",
    `${WINDOWS_REGISTRY_ROOTS[browser]}\\${NM_HOST_NAME}`,
    "/ve",
    "/t",
    "REG_SZ",
    "/d",
    manifestPath,
    "/f",
  ]);
}

/** reg.exe commands removing the registration again (uninstall path). */
export function windowsRegistryDeleteCommands(browsers: NmBrowser[] = ["chrome"]): string[][] {
  return browsers.map((browser) => ["delete", `${WINDOWS_REGISTRY_ROOTS[browser]}\\${NM_HOST_NAME}`, "/f"]);
}

// ---------------------------------------------------------------------------
// Installation (idempotent)
// ---------------------------------------------------------------------------

export type InstalledNmHost = {
  mode: NmHostInstallMode;
  manifestPaths: { browser: NmBrowser; path: string }[];
  wrapperPath: string;
  runtime: string;
  shimPath: string;
};

export type InstallNmHostOptions = {
  /** Default "dev" (repo shim + system node); "installed" uses the packaged resources. */
  mode?: NmHostInstallMode;
  extensionId?: string;
  shimPath?: string;
  nodeBinary?: string;
  /** Overrides process.execPath (tests / exotic packaging). */
  electronBinary?: string;
  /** macOS/Linux browsers to register; default chrome. */
  browsers?: NmBrowser[];
  /** Registry exec injection (tests); default real reg.exe on win32. */
  runRegistryCommand?: (args: string[]) => void;
};

export function installNmHost(options?: InstallNmHostOptions): InstalledNmHost {
  const mode = options?.mode ?? "dev";
  const extensionId = options?.extensionId ?? SPIKE_EXTENSION_ID;
  const browsers = options?.browsers ?? ["chrome"];
  const shimPath = options?.shimPath ?? (mode === "installed" ? defaultInstalledShimPath() : defaultDevShimPath());
  const nodeBinary = options?.nodeBinary ?? resolveNodeBinary();
  const electronBinary = options?.electronBinary ?? process.execPath;

  if (!fs.existsSync(shimPath)) {
    throw new Error(`NM host shim not found: ${shimPath}`);
  }

  if (process.platform === "win32") {
    return installWindows({ mode, extensionId, shimPath, nodeBinary, electronBinary, browsers, runRegistryCommand: options?.runRegistryCommand });
  }
  return installPosix({ mode, extensionId, shimPath, nodeBinary, electronBinary, browsers });
}

type InstallParams = Required<Pick<InstallNmHostOptions, "mode" | "extensionId" | "shimPath" | "nodeBinary" | "electronBinary" | "browsers">> & {
  runRegistryCommand?: (args: string[]) => void;
};

function installPosix(params: InstallParams): InstalledNmHost {
  const wrapperPath = nmHostWrapperPath();
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  fs.writeFileSync(
    wrapperPath,
    buildPosixWrapperScript({
      mode: params.mode,
      nodeBinary: params.nodeBinary,
      electronBinary: params.electronBinary,
      shimPath: params.shimPath,
    }),
    { encoding: "utf-8", mode: 0o755 },
  );
  fs.chmodSync(wrapperPath, 0o755);

  const manifest = buildNmHostManifest(params.extensionId, wrapperPath);
  const manifestPaths = params.browsers.map((browser) => {
    const manifestPath = nmHostManifestPathFor(browser);
    fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
    fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf-8" });
    return { browser, path: manifestPath };
  });

  console.log(
    `[native-messaging-host] installed ${NM_HOST_NAME} (${params.mode}): ` +
      `manifest=${manifestPaths.map((row) => `${row.browser}:${row.path}`).join(", ")} wrapper=${wrapperPath} shim=${params.shimPath}`,
  );
  return {
    mode: params.mode,
    manifestPaths,
    wrapperPath,
    runtime: params.mode === "installed" ? params.electronBinary : params.nodeBinary,
    shimPath: params.shimPath,
  };
}

function installWindows(params: InstallParams): InstalledNmHost {
  const wrapperPath = nmHostWrapperPathWindows();
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  fs.writeFileSync(
    wrapperPath,
    buildWindowsWrapperScript({
      mode: params.mode,
      nodeBinary: params.nodeBinary,
      electronBinary: params.electronBinary,
      shimPath: params.shimPath,
    }),
    { encoding: "utf-8" },
  );

  // Manifest JSON lives next to the wrapper; the registry default value
  // points to it (Windows NM lookup is registry-only).
  const manifestPath = nmHostManifestPathWindows();
  const manifest = buildNmHostManifest(params.extensionId, wrapperPath);
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf-8" });

  const run = params.runRegistryCommand ?? ((args: string[]) => execFileSync("reg", args, { encoding: "utf8" }));
  for (const browser of params.browsers) {
    const [command] = windowsRegistryAddCommands(manifestPath, [browser]);
    run(command);
  }

  console.log(
    `[native-messaging-host] installed ${NM_HOST_NAME} (${params.mode}, win32): ` +
      `manifest=${manifestPath} wrapper=${wrapperPath} registry=[${params.browsers.join(", ")}]`,
  );
  return {
    mode: params.mode,
    manifestPaths: [{ browser: "chrome", path: manifestPath }],
    wrapperPath,
    runtime: params.mode === "installed" ? params.electronBinary : params.nodeBinary,
    shimPath: params.shimPath,
  };
}

export function uninstallNmHost(browsers?: NmBrowser[]): void {
  const targets = browsers ?? (["chrome", "edge", "chromium"] as NmBrowser[]);
  for (const filePath of [nmHostWrapperPath(), nmHostWrapperPathWindows(), nmHostManifestPathWindows()]) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* missing is fine */
    }
  }
  for (const browser of targets) {
    try {
      fs.unlinkSync(nmHostManifestPathFor(browser));
    } catch {
      /* missing is fine */
    }
  }
  if (process.platform === "win32") {
    for (const args of windowsRegistryDeleteCommands(targets)) {
      try {
        execFileSync("reg", args, { encoding: "utf8" });
      } catch {
        /* missing key is fine */
      }
    }
  }
}
