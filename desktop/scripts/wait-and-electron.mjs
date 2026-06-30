#!/usr/bin/env node
/**
 * Wait for the Vite dev server and compiled main process, then launch Electron.
 * Keeps wait-on port aligned with vite.config.ts / electron/main.ts via AGX_DEV_PORT.
 *
 * Author: Damon Li
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const DEFAULT_DEV_PORT = "5713";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = process.env.AGX_DEV_PORT || DEFAULT_DEV_PORT;
process.env.AGX_DEV_PORT = port;

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

const electronPath = require("electron");
run("electron", electronPath, ["."]);
