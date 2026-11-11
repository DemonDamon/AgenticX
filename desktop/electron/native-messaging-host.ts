/**
 * SP1 · NM Channel Spike — installs the Chrome Native Messaging host manifest.
 *
 * Manifest format per
 * https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging:
 * macOS user-level manifest lives in
 *   ~/Library/Application Support/Google/Chrome/NativeMessagingHosts/<name>.json
 * with fields name/description/path/type:"stdio"/allowed_origins, where path
 * MUST be absolute on macOS. `allowed_origins` cannot contain wildcards, so
 * the unpacked extension ID is locked via the fixed "key" field in
 * extension/manifest.json (see SP1 plan for the key/ID record).
 *
 * The host binary is a wrapper shell script that execs a real node interpreter
 * on the in-repo shim (scripts/nm-bridge-shim.mjs) — acceptable for the spike;
 * TODO(SP6): bundle a standalone host binary for packaged builds.
 * TODO(SP6): Windows needs the HKCU/HKLM NativeMessagingHosts registry key
 * instead of this manifest file — out of spike scope (macOS only).
 *
 * Mountable from electron/main.ts (this spike does NOT wire it in):
 *
 *   import { installNmHost } from "./native-messaging-host";
 *   installNmHost(); // idempotent
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

export function nmHostManifestPath(): string {
  return path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "Google",
    "Chrome",
    "NativeMessagingHosts",
    `${NM_HOST_NAME}.json`,
  );
}

export function nmHostWrapperPath(): string {
  return path.join(os.homedir(), ".agenticx", "agx-nm-bridge-host.sh");
}

/** electron/*.ts compiles to dist-electron/*.js → repo root is two levels up. */
function defaultShimPath(): string {
  return path.resolve(__dirname, "..", "..", "scripts", "nm-bridge-shim.mjs");
}

function resolveNodeBinary(): string {
  const versions = process.versions as Record<string, string | undefined>;
  if (!versions.electron) {
    // Running under a plain node process (e.g. manual spike tooling).
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

export type InstalledNmHost = {
  manifestPath: string;
  wrapperPath: string;
  nodeBinary: string;
  shimPath: string;
};

export function installNmHost(
  options?: { extensionId?: string; nodeBinary?: string; shimPath?: string },
): InstalledNmHost {
  const extensionId = options?.extensionId ?? SPIKE_EXTENSION_ID;
  const shimPath = options?.shimPath ?? defaultShimPath();
  const nodeBinary = options?.nodeBinary ?? resolveNodeBinary();
  const wrapperPath = nmHostWrapperPath();
  const manifestPath = nmHostManifestPath();

  if (!fs.existsSync(shimPath)) {
    throw new Error(`NM host shim not found: ${shimPath}`);
  }

  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexec ${JSON.stringify(nodeBinary)} ${JSON.stringify(shimPath)} "$@"\n`,
    { encoding: "utf-8", mode: 0o755 },
  );
  fs.chmodSync(wrapperPath, 0o755);

  const manifest = {
    name: NM_HOST_NAME,
    description: "AgenticX browser extension bridge (NM channel spike)",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${extensionId}/`],
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf-8" });

  console.log(
    `[native-messaging-host] installed ${NM_HOST_NAME}: manifest=${manifestPath} wrapper=${wrapperPath}`,
  );
  return { manifestPath, wrapperPath, nodeBinary, shimPath };
}

export function uninstallNmHost(): void {
  for (const filePath of [nmHostManifestPath(), nmHostWrapperPath()]) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* missing is fine */
    }
  }
}
