#!/usr/bin/env node
/**
 * SP2 e2e · ExtensionBackend bridge verification.
 *
 * Drives the full pipeline "agent HTTP POST /v1/browser/act → browser-bridge
 * routing → NM socket → shim → extension stub → act_result → settle()" against
 * the COMPILED desktop code (dist-electron/browser-bridge.js +
 * dist-electron/nm-socket-server.js), with the electron module mocked out so
 * plain node can host the bridge.
 *
 * Phase A (always runs, shim-mock mode): a fake extension speaks JSONL directly
 * on the unix socket — exactly what the shim relays for the SW — and checks:
 *   A1. AGX_BROWSER_BACKEND=extension → act forwarded, stub act_result settles
 *   A2. auto + extension online → still routes to the extension
 *   A3. auto + extension gone → falls back to embedded (this harness has no
 *       WorkPanel host, so the embedded leg answers desktop_window_unavailable
 *       — proof the embedded branch was taken)
 *   A4. explicit extension + offline → {ok:false, error:"extension_offline"}
 *   A5. GET /v1/browser/status liveness transitions (auth'd)
 *
 * Phase B (best effort, real browser): boots Chrome for Testing with the real
 * extension/ loaded (SP1 verify-nm-channel.mjs pattern — NM host manifest goes
 * inside --user-data-dir per SP1 finding #2); the real SW + executor-stub must
 * answer through the real NM pipeline. BLOCKED (exit 0 with a note) when no
 * automation-capable browser exists; SP1 finding #1 means branded Google Chrome
 * ignores --load-extension.
 *
 * Exit code: 0 PASS (Phase A always, Phase B PASS or BLOCKED) / 1 FAIL.
 *
 * Author: Damon Li
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { delay, waitFor, NM_HOST_NAME, SPIKE_EXTENSION_ID } from "./helpers.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DESKTOP_DIR = path.join(REPO_ROOT, "desktop");
const DIST_DIR = path.join(DESKTOP_DIR, "dist-electron");
const EXTENSION_DIR = path.join(REPO_ROOT, "extension");
const SHIM_PATH = path.join(REPO_ROOT, "scripts", "nm-bridge-shim.mjs");
const GOOGLE_CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE_DIR = "/tmp/agx-sp2-e2e-profile";
const DEBUG_PORT = 9223;
const SW_ONLINE_BUDGET_MS = 45_000;

// SP3 made the real executor the default; this script validates the stub
// pipeline, so pin the stub branch (bridge forwards AGX_EXT_STUB=1 as
// stub:true and the SW stays on executor-stub.js — SP2 acceptance unbroken).
process.env.AGX_EXT_STUB = "1";

const require = createRequire(import.meta.url);
let failures = 0;

function fail(message) {
  console.error(`FAIL ${message}`);
  failures += 1;
}

function assert(condition, label) {
  if (condition) {
    console.log(`PASS ${label}`);
  } else {
    fail(label);
  }
}

function logStep(label, requestBody, reply, ms) {
  console.log(`\n[${label}] request : ${JSON.stringify(requestBody)}`);
  console.log(`[${label}] response: ${JSON.stringify(reply)}`);
  console.log(`[${label}] roundtrip: ${ms}ms`);
}

// ---------------------------------------------------------------------------
// compiled desktop bridge + electron mock
// ---------------------------------------------------------------------------

function buildDesktop() {
  console.log("[verify] compiling desktop electron TS …");
  const result = spawnSync("npx", ["tsc", "-p", "electron/tsconfig.json"], {
    cwd: DESKTOP_DIR,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`tsc failed:\n${result.stdout}\n${result.stderr}`);
  }
}

function loadBridgeWithMockElectron(workDir) {
  const mockPath = path.join(workDir, "mock-electron.cjs");
  fs.writeFileSync(
    mockPath,
    `"use strict";
// Minimal electron main-process mock: enough for dist-electron/browser-bridge.js
// (ipcMain.handle/removeHandler) under plain node. No renderer exists in this
// harness, so the embedded backend answers desktop_window_unavailable.
const handlers = new Map();
module.exports = {
  ipcMain: {
    handle: (channel, fn) => handlers.set(channel, fn),
    removeHandler: (channel) => handlers.delete(channel),
  },
  webContents: { fromId: () => null },
};
`,
    "utf8",
  );
  const Module = require("node:module");
  const origResolve = Module._resolveFilename;
  Module._resolveFilename = function (request, parent, isMain, options) {
    if (request === "electron") return mockPath;
    return origResolve.call(this, request, parent, isMain, options);
  };
  return require(path.join(DIST_DIR, "browser-bridge.js"));
}

// ---------------------------------------------------------------------------
// agent-side helpers (mirror agenticx/cli/agent_tools.py L3966-4016)
// ---------------------------------------------------------------------------

async function waitForBridgeFiles(agxHome) {
  const portFile = path.join(agxHome, "browser_bridge.port");
  const tokenFile = path.join(agxHome, "browser_bridge.token");
  return waitFor(() => {
    try {
      const port = Number(fs.readFileSync(portFile, "utf8").trim());
      const token = fs.readFileSync(tokenFile, "utf8").trim();
      return Number.isInteger(port) && token ? { base: `http://127.0.0.1:${port}`, token } : null;
    } catch {
      return null;
    }
  }, 5_000, "bridge port/token files");
}

async function postAct(endpoint, body) {
  const res = await fetch(`${endpoint.base}/v1/browser/act`, {
    method: "POST",
    headers: { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return (await res.json());
}

async function getStatus(endpoint) {
  const res = await fetch(`${endpoint.base}/v1/browser/status`, {
    headers: { Authorization: `Bearer ${endpoint.token}` },
  });
  return (await res.json());
}

/** Fake extension: speaks JSONL directly on the NM socket (what the shim relays). */
function connectFakeExtension(socketPath) {
  const socket = net.connect(socketPath);
  socket.setEncoding("utf8");
  const waiters = [];
  let buffer = "";
  socket.on("data", (chunk) => {
    buffer += chunk;
    let newline = buffer.indexOf("\n");
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      const row = JSON.parse(line);
      const index = waiters.findIndex((w) => w.type === row.type);
      if (index !== -1) waiters.splice(index, 1)[0].resolve(row);
    }
  });
  socket.on("error", () => {
    /* teardown */
  });
  return {
    send: (message) => socket.write(`${JSON.stringify(message)}\n`),
    waitForMessage: (type) => new Promise((resolve) => waiters.push({ type, resolve })),
    destroy: () => socket.destroy(),
  };
}

// ---------------------------------------------------------------------------
// Phase A — shim-mock mode (fake extension on the unix socket)
// ---------------------------------------------------------------------------

async function runShimMockPhase(workDir) {
  console.log("\n=== Phase A: shim-mock mode (fake extension on the NM socket) ===");
  const bridge = loadBridgeWithMockElectron(workDir);

  const agxHome = path.join(workDir, "agx-home");
  const socketPath = path.join(workDir, "browser_bridge_nm.sock");
  process.env.AGX_HOME = agxHome;
  process.env.AGX_NM_SOCKET_PATH = socketPath;
  process.env.AGX_BROWSER_BACKEND = "extension";

  bridge.startNearBrowserBridge(() => null);
  const endpoint = await waitForBridgeFiles(agxHome);

  // A1: extension backend, fake extension answers with the stub payload
  const ext = connectFakeExtension(socketPath);
  ext.send({ type: "ping", ts: Date.now() }); // SP1 heartbeat → liveness
  await waitFor(async () => (await getStatus(endpoint)).extension_online === true, 5_000,
    "extension_online=true after ping");

  const a1Request = { session_id: "sp2-e2e", action: "open", url: "https://example.com/" };
  let t0 = Date.now();
  const a1Pending = postAct(endpoint, a1Request);
  const a1Act = await ext.waitForMessage("act");
  ext.send({
    type: "act_result",
    request_id: a1Act.request_id,
    ok: true,
    action: a1Act.action,
    url: "about:blank",
    text: "[stub]",
    backend: "extension",
  });
  const a1Reply = await a1Pending;
  const a1Ms = Date.now() - t0;
  logStep("A1 extension backend", a1Request, a1Reply, a1Ms);
  assert(
    a1Reply.ok === true &&
      a1Reply.backend === "extension" &&
      a1Reply.text === "[stub]" &&
      a1Reply.url === "about:blank" &&
      a1Reply.request_id === a1Act.request_id,
    "A1 act → NM → stub → settle (request_id preserved, backend=extension)",
  );
  assert(a1Act.session_id === "sp2-e2e" && a1Act.action === "open", "A1 forwarded payload keeps session_id/action");

  // A2: auto mode + extension online → still extension
  process.env.AGX_BROWSER_BACKEND = "auto";
  const a2Request = { session_id: "sp2-e2e", action: "click", index: 3 };
  t0 = Date.now();
  const a2Pending = postAct(endpoint, a2Request);
  const a2Act = await ext.waitForMessage("act");
  ext.send({
    type: "act_result",
    request_id: a2Act.request_id,
    ok: true,
    action: a2Act.action,
    url: "about:blank",
    text: "[stub]",
    backend: "extension",
  });
  const a2Reply = await a2Pending;
  logStep("A2 auto+online", a2Request, a2Reply, Date.now() - t0);
  assert(a2Reply.ok === true && a2Reply.backend === "extension", "A2 auto mode routes to the extension while online");

  // A3: extension gone → auto falls back to embedded (no WorkPanel host in
  // this harness → desktop_window_unavailable proves the embedded branch)
  ext.destroy();
  await waitFor(async () => (await getStatus(endpoint)).extension_online === false, 5_000,
    "extension_online=false after disconnect");
  const a3Request = { session_id: "sp2-e2e", action: "snapshot" };
  t0 = Date.now();
  const a3Reply = await postAct(endpoint, a3Request);
  logStep("A3 auto+offline → embedded fallback", a3Request, a3Reply, Date.now() - t0);
  assert(
    a3Reply.ok === false && a3Reply.error === "desktop_window_unavailable",
    "A3 auto mode falls back to the embedded path when the extension is gone",
  );

  // A4: explicit extension backend + offline → dedicated error, no silent fallback
  process.env.AGX_BROWSER_BACKEND = "extension";
  const a4Request = { session_id: "sp2-e2e", action: "extract_text", query: "hello" };
  t0 = Date.now();
  const a4Reply = await postAct(endpoint, a4Request);
  logStep("A4 extension+offline", a4Request, a4Reply, Date.now() - t0);
  assert(
    a4Reply.ok === false && a4Reply.error === "extension_offline",
    "A4 explicit extension backend reports extension_offline instead of falling back",
  );

  // A5: status endpoint shape (auth'd)
  const a5Status = await getStatus(endpoint);
  console.log(`\n[A5] /v1/browser/status → ${JSON.stringify(a5Status)}`);
  assert(
    a5Status.ok === true && a5Status.backend === "extension" && a5Status.extension_online === false,
    "A5 status reports backend mode + heartbeat liveness",
  );
  const unauth = await fetch(`${endpoint.base}/v1/browser/status`);
  assert(unauth.status === 401, "A5 status requires the bearer token (401 without)");

  bridge.stopNearBrowserBridge();
  await delay(150); // let the async NM close finish before Phase B rebinds
}

// ---------------------------------------------------------------------------
// Phase B — real browser (Chrome for Testing + real extension SW)
// ---------------------------------------------------------------------------

function playwrightChromeForTesting() {
  const cache = path.join(os.homedir(), "Library", "Caches", "ms-playwright");
  try {
    const versions = fs
      .readdirSync(cache)
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const version of versions) {
      const bin = path.join(
        cache,
        version,
        "chrome-mac-arm64",
        "Google Chrome for Testing.app",
        "Contents",
        "MacOS",
        "Google Chrome for Testing",
      );
      if (fs.existsSync(bin)) return bin;
    }
  } catch {
    return null;
  }
  return null;
}

function resolveBrowser() {
  const forTesting = playwrightChromeForTesting();
  if (forTesting) return { binary: forTesting, kind: "chrome_for_testing" };
  if (fs.existsSync(GOOGLE_CHROME_BIN)) return { binary: GOOGLE_CHROME_BIN, kind: "google_chrome" };
  return null;
}

async function isDebugPortTaken() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

function findShimPids() {
  try {
    const out = spawnSync("pgrep", ["-f", "scripts/nm-bridge-shim.mjs"], { encoding: "utf8" });
    if (out.status !== 0) return [];
    return out
      .toString()
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return [];
  }
}

/**
 * SP1 finding #2: NM host manifests are looked up in NativeMessagingHosts/
 * INSIDE the --user-data-dir profile. The wrapper execs node on the in-repo
 * shim; AGX_NM_SOCKET_PATH is inherited so the shim reaches this harness's
 * isolated socket instead of the real ~/.agenticx one.
 */
function installNmHostIntoProfile(socketPath) {
  if (!fs.existsSync(SHIM_PATH)) throw new Error(`shim not found: ${SHIM_PATH}`);
  const wrapperPath = path.join(os.homedir(), ".agenticx", "agx-nm-bridge-host.sh");
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(SHIM_PATH)} "$@"\n`,
    { encoding: "utf-8", mode: 0o755 },
  );
  fs.chmodSync(wrapperPath, 0o755);
  const manifestPath = path.join(PROFILE_DIR, "NativeMessagingHosts", `${NM_HOST_NAME}.json`);
  const manifest = {
    name: NM_HOST_NAME,
    description: "AgenticX browser extension bridge (SP2 e2e)",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${SPIKE_EXTENSION_ID}/`],
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf-8" });
  console.log(`[verify] NM host installed: ${manifestPath} (socket=${socketPath})`);
}

async function runRealBrowserPhase(workDir) {
  console.log("\n=== Phase B: real browser (Chrome for Testing + real extension SW) ===");
  const browser = resolveBrowser();
  if (!browser) {
    console.log(
      "BLOCKED: no automation-capable browser found (playwright Chrome for Testing missing and no Google Chrome). " +
        "Phase A already proved the compiled bridge pipeline; the only untested delta is the SW-side " +
        "act dispatch (extension/src/sw.js + executor-stub.js), which needs manual chrome://extensions loading.",
    );
    return;
  }
  if (browser.kind === "google_chrome") {
    console.log(
      "BLOCKED: only branded Google Chrome found — it ignores --load-extension (SP1 finding #1); " +
        "load extension/ manually via chrome://extensions to cover the SW dispatch by hand.",
    );
    return;
  }
  if (fs.existsSync(PROFILE_DIR)) {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  }
  if (await isDebugPortTaken()) {
    throw new Error(`port ${DEBUG_PORT} already serves a DevTools endpoint — stop it first`);
  }

  console.log(`[verify] browser: ${browser.kind} (${browser.binary})`);
  const agxHome = path.join(workDir, "agx-home");
  const socketPath = path.join(workDir, "browser_bridge_nm.sock");
  installNmHostIntoProfile(socketPath);

  // Same module instance as Phase A (require cache) — stop/start is supported.
  const bridge = loadBridgeWithMockElectron(workDir);
  process.env.AGX_HOME = agxHome;
  process.env.AGX_NM_SOCKET_PATH = socketPath;
  process.env.AGX_BROWSER_BACKEND = "extension";
  bridge.startNearBrowserBridge(() => null);
  const endpoint = await waitForBridgeFiles(agxHome);

  const chrome = spawn(
    browser.binary,
    [
      `--user-data-dir=${PROFILE_DIR}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      "--remote-allow-origins=*",
      `--load-extension=${EXTENSION_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env } },
  );
  const chromeStderr = [];
  chrome.stderr.on("data", (chunk) => chromeStderr.push(chunk));

  try {
    // SP2 liveness signal: the real SW connects via NM and pings.
    console.log("[verify] waiting for the extension SW to come online via NM …");
    let swOnline = true;
    try {
      await waitFor(
        async () => (await getStatus(endpoint)).extension_online === true,
        SW_ONLINE_BUDGET_MS,
        "extension SW online (NM ping seen by the bridge)",
      );
    } catch (err) {
      swOnline = false;
      console.log(`[verify] SW never came online: ${err.message}`);
      console.log(`[verify] NM shim processes alive: ${findShimPids().length}`);
      const text = Buffer.concat(chromeStderr).toString("utf8");
      console.log(`[verify] chrome stderr (tail):\n${text.split("\n").slice(-15).join("\n")}`);
    }
    const status = await getStatus(endpoint);
    console.log(`[verify] /v1/browser/status → ${JSON.stringify(status)}`);
    assert(
      status.extension_online === true && swOnline,
      "B0 real extension SW heartbeat reaches the compiled bridge (extension_online=true)",
    );

    const b1Request = { session_id: "sp2-e2e-real", action: "open", url: "https://example.com/" };
    const t0 = Date.now();
    const b1Reply = await postAct(endpoint, b1Request);
    const ms = Date.now() - t0;
    logStep("B1 real SW executor-stub", b1Request, b1Reply, ms);
    assert(
      b1Reply.ok === true &&
        b1Reply.backend === "extension" &&
        b1Reply.text === "[stub]" &&
        b1Reply.url === "about:blank" &&
        typeof b1Reply.request_id === "string",
      "B1 agent POST → NM → real SW stub → act_result settles (backend=extension)",
    );
  } finally {
    chrome.kill("SIGTERM");
    await delay(1000);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    bridge.stopNearBrowserBridge();
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    const text = Buffer.concat(chromeStderr).toString("utf8");
    const native = text
      .split("\n")
      .filter((line) => /native_messag|load_extension/i.test(line))
      .slice(0, 10);
    if (native.length) console.log(`[verify] browser NM/extension log lines:\n${native.join("\n")}`);
    console.log("[verify] cleaned up: browser killed, profile removed, bridge stopped");
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-sp2-e2e-"));
  try {
    buildDesktop();
    await runShimMockPhase(workDir);
    await runRealBrowserPhase(workDir);
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
  console.log(failures ? `\nRESULT: FAIL (${failures})` : "\nRESULT: PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`RESULT: FAIL (${err.message})`);
  process.exit(1);
});
