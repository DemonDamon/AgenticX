#!/usr/bin/env node
/**
 * Wait for the Vite dev server and compiled main process, then launch Electron.
 * Keeps wait-on port aligned with vite.config.ts / electron/main.ts via AGX_DEV_PORT.
 *
 * Author: Damon Li
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const DEFAULT_DEV_PORT = "5713";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.AGX_DEV_PORT || DEFAULT_DEV_PORT;
process.env.AGX_DEV_PORT = port;

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function waitForFreshElectronBuild(projectRoot) {
  const started = Date.now();
  const mainJs = path.join(projectRoot, "dist-electron/main.js");
  const bridgeJs = path.join(projectRoot, "dist-electron/browser-bridge.js");
  const deadline = started + 120_000;
  let lastSig = "";
  let stableSince = 0;
  let sawFresh = false;

  while (Date.now() < deadline) {
    let mainText = "";
    let bridgeText = "";
    try {
      mainText = fs.readFileSync(mainJs, "utf8");
      bridgeText = fs.readFileSync(bridgeJs, "utf8");
    } catch {
      lastSig = "";
      stableSince = 0;
      sleepSync(200);
      continue;
    }
    if (
      !mainText.includes("startNearBrowserBridge")
      || !bridgeText.includes("function startNearBrowserBridge")
    ) {
      lastSig = "";
      stableSince = 0;
      sleepSync(200);
      continue;
    }
    const mainStat = fs.statSync(mainJs);
    const bridgeStat = fs.statSync(bridgeJs);
    const sig = `${mainStat.mtimeMs}:${mainStat.size}|${bridgeStat.mtimeMs}:${bridgeStat.size}`;
    if (mainStat.mtimeMs >= started - 100 && bridgeStat.mtimeMs >= started - 100) {
      sawFresh = true;
    }
    if (sig !== lastSig) {
      lastSig = sig;
      stableSince = Date.now();
      sleepSync(200);
      continue;
    }
    const stableFor = Date.now() - stableSince;
    if (stableFor >= 800 && (sawFresh || Date.now() - started > 15_000)) {
      return;
    }
    sleepSync(200);
  }
  console.error("[dev] timed out waiting for dist-electron to finish compiling");
  process.exit(1);
}

function run(label, command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`[dev] ${label} failed:`, result.error.message);
    process.exit(1);
  }
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

const waitOnEntry = require.resolve("wait-on/bin/wait-on");
run("wait-on", process.execPath, [
  waitOnEntry,
  `tcp:${port}`,
  "dist-electron/main.js",
]);

// tsc --watch rewrites dist-electron after this script starts. wait-on only
// checks that main.js already exists, so Electron can load a half-written
// browser-bridge.js and crash with "startNearBrowserBridge is not a function".
waitForFreshElectronBuild(root);

const electronPath = require("electron");
run("electron", electronPath, ["."]);
