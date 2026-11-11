#!/usr/bin/env node
/**
 * SP1 e2e · real-browser NM channel verification.
 *
 * Boots an isolated browser (own profile, CDP on 9222) with extension/ loaded,
 * plus the JSONL echo server in place of the desktop process, then asserts:
 *   1. the extension SW establishes the NM connection and records a pong RTT;
 *   2. after the NM shim process is SIGKILLed, the SW reconnects and records a
 *      fresh pong within 30s.
 *
 * Browser choice: branded Google Chrome (137+) ignores --load-extension, so the
 * script prefers playwright's bundled "Chrome for Testing" build; either way a
 * real Chromium-family browser drives the real NM pipeline.
 *
 * BLOCKED semantics: if no automation-capable browser is found, print BLOCKED
 * and exit 2 (per SP1 plan this check is skipped, not failed).
 * Exit code: 0 PASS / 1 FAIL / 2 BLOCKED.
 *
 * Author: Damon Li
 */

import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  startEchoServer,
  nmSocketPath,
  delay,
  waitFor,
  NM_HOST_NAME,
  SPIKE_EXTENSION_ID,
} from "./helpers.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXTENSION_DIR = path.join(REPO_ROOT, "extension");
const SHIM_PATH = path.join(REPO_ROOT, "scripts", "nm-bridge-shim.mjs");
const GOOGLE_CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE_DIR = "/tmp/agx-nm-e2e-profile";
const DEBUG_PORT = 9222;
const SW_LAUNCH_BUDGET_MS = 30_000;
const CONNECT_BUDGET_MS = 30_000;
const RECONNECT_BUDGET_MS = 30_000;
const EVALUATE_TIMEOUT_MS = 5_000;

/** Branded Google Chrome (137+) ignores --load-extension for unpacked extensions. */
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
  if (fs.existsSync(GOOGLE_CHROME_BIN)) {
    return { binary: GOOGLE_CHROME_BIN, kind: "google_chrome" };
  }
  return null;
}

function nmHostWrapperPath() {
  return path.join(os.homedir(), ".agenticx", "agx-nm-bridge-host.sh");
}

/**
 * NM host manifests are looked up in the NativeMessagingHosts/ subdirectory
 * of the *user profile directory* (Chrome NM doc), so with --user-data-dir
 * pointed at our throwaway profile the manifest must live inside it.
 */
function installNmHost() {
  if (!fs.existsSync(SHIM_PATH)) throw new Error(`shim not found: ${SHIM_PATH}`);
  const wrapperPath = nmHostWrapperPath();
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
    description: "AgenticX browser extension bridge (NM channel spike)",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${SPIKE_EXTENSION_ID}/`],
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf-8",
  });
  console.log(`[verify] NM host installed: ${manifestPath}`);
}

async function isDebugPortTaken() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    return response.ok;
  } catch {
    return false;
  }
}

async function findServiceWorkerTarget() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
  if (!response.ok) return null;
  const targets = await response.json();
  return (
    targets.find(
      (t) =>
        t.type === "service_worker" &&
        t.url.startsWith(`chrome-extension://${SPIKE_EXTENSION_ID}`),
    ) ?? null
  );
}

function connectCdp(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let messageId = 0;
    const pending = new Map();
    const failAll = (reason) => {
      for (const { rej } of pending.values()) rej(new Error(reason));
      pending.clear();
    };
    ws.addEventListener("open", () => {
      resolve({
        close: () => ws.close(),
        send(method, params) {
          return new Promise((res, rej) => {
            const id = (messageId += 1);
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params }));
          });
        },
      });
    });
    ws.addEventListener("error", () => {
      reject(new Error(`CDP websocket failed: ${wsUrl}`));
      failAll("CDP websocket error");
    });
    ws.addEventListener("close", () => failAll("CDP websocket closed"));
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      const entry = pending.get(message.id);
      if (!entry) return;
      pending.delete(message.id);
      if (message.error) entry.rej(new Error(message.error.message ?? "CDP error"));
      else entry.res(message.result);
    });
  });
}

function withTimeout(promise, ms, label) {
  return Promise.race([
    promise,
    new Promise((_, rej) => {
      setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
    }),
  ]);
}

/**
 * CDP session that survives SW target recycling: a dead/broken connection is
 * re-resolved from /json on the next poll.
 */
function createCdpSession() {
  let cdp = null;
  let broken = false;
  return {
    close() {
      if (cdp) cdp.close();
      cdp = null;
      broken = true;
    },
    async evaluate(expression, label) {
      if (!cdp || broken) {
        if (cdp) cdp.close();
        cdp = null;
        const target = await waitFor(
          findServiceWorkerTarget,
          SW_LAUNCH_BUDGET_MS,
          "service worker target",
        );
        cdp = await connectCdp(target.webSocketDebuggerUrl);
        broken = false;
      }
      try {
        const result = await withTimeout(
          cdp.send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
          }),
          EVALUATE_TIMEOUT_MS,
          `evaluate ${label}`,
        );
        if (result.exceptionDetails) {
          // A freshly-registered SW may briefly lack its chrome.* bindings.
          console.log(
            `[verify] evaluate not ready (${label}): ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "?"}`,
          );
          return null;
        }
        return result.result?.value ?? null;
      } catch (err) {
        console.log(`[verify] CDP hiccup (${label}): ${err.message} — reconnecting`);
        broken = true;
        return null;
      }
    },
  };
}

function findShimPids() {
  try {
    const out = execFileSync("pgrep", ["-f", "scripts/nm-bridge-shim.mjs"], {
      encoding: "utf8",
    });
    return out
      .split("\n")
      .map((line) => Number(line.trim()))
      // pid 0 would SIGKILL the whole process group (us included) — trailing
      // newline from pgrep splits into "" and Number("") === 0.
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return [];
  }
}

function summarize(nm) {
  if (!nm) return "nm=null";
  return `status=${nm.status} lastPongAt=${nm.lastPongAt ?? "-"} lastRttMs=${nm.lastRttMs ?? "-"} attempts=${nm.reconnectAttempts ?? "-"} samples=${nm.rttSamples?.length ?? 0}`;
}

async function main() {
  const browser = resolveBrowser();
  if (!browser) {
    console.log(
      `BLOCKED: no automation-capable browser found (Google Chrome at ${GOOGLE_CHROME_BIN} and playwright's Chrome for Testing are both missing — SP1 real-browser check skipped)`,
    );
    process.exit(2);
  }
  if (fs.existsSync(PROFILE_DIR)) {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  }
  if (await isDebugPortTaken()) {
    throw new Error(`port ${DEBUG_PORT} already serves a DevTools endpoint — stop it or change DEBUG_PORT`);
  }

  console.log(`[verify] browser: ${browser.kind} (${browser.binary})`);
  installNmHost();
  const server = await startEchoServer(nmSocketPath());
  console.log(`[verify] echo server on ${server.socketPath}`);

  const chrome = spawn(
    browser.binary,
    [
      `--user-data-dir=${PROFILE_DIR}`,
      `--remote-debugging-port=${DEBUG_PORT}`,
      `--remote-allow-origins=*`,
      `--load-extension=${EXTENSION_DIR}`,
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const chromeStderr = [];
  chrome.stderr.on("data", (chunk) => chromeStderr.push(chunk));

  let session = null;
  let failures = 0;
  const fail = (message) => {
    console.error(`FAIL ${message}`);
    failures += 1;
  };

  try {
    await waitFor(async () => {
      try {
        const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
        return response.ok;
      } catch {
        return false;
      }
    }, SW_LAUNCH_BUDGET_MS, "browser CDP endpoint");
    console.log("[verify] browser is up, CDP listening");

    const swTarget = await waitFor(
      findServiceWorkerTarget,
      SW_LAUNCH_BUDGET_MS,
      `service worker target for ${SPIKE_EXTENSION_ID}`,
    );
    console.log(`[verify] service worker target: ${swTarget.url}`);
    session = createCdpSession();

    // ---- phase 1: NM connection + pong RTT recorded ----
    const phase1 = await waitFor(async () => {
      const nm = await session.evaluate(
        "chrome.storage.local.get('nm').then(r => r.nm || null)",
        "phase1",
      );
      return nm && nm.status === "connected" && typeof nm.lastRttMs === "number" ? nm : null;
    }, CONNECT_BUDGET_MS, "nm.status=connected with RTT");
    if (phase1) {
      console.log(`PASS phase 1: ${summarize(phase1)}`);
    } else {
      fail("phase 1: NM connection/RTT never recorded");
    }

    // ---- phase 2: kill the shim, expect self-healing reconnect ≤30s ----
    const pids = findShimPids();
    if (pids.length === 0) {
      fail("phase 2: no NM shim process found to kill");
    } else {
      const killAt = Date.now();
      const pongBeforeKill = phase1 ? phase1.lastPongAt : 0;
      for (const pid of pids) process.kill(pid, "SIGKILL");
      console.log(`[verify] killed shim pids [${pids.join(", ")}] at ${killAt}`);

      let lastLog = 0;
      const healed = await waitFor(async () => {
        const nm = await session.evaluate(
          "chrome.storage.local.get('nm').then(r => r.nm || null)",
          "phase2",
        );
        if (!nm) return null;
        const now = Date.now();
        if (now - lastLog > 5000) {
          lastLog = now;
          console.log(`[verify] phase 2 polling: ${summarize(nm)}`);
        }
        const pongAt = nm.lastPongAt ?? 0;
        return pongAt > killAt && pongAt > pongBeforeKill ? nm : null;
      }, RECONNECT_BUDGET_MS, "pong recorded after shim kill");
      if (healed) {
        const tookMs = (healed.lastPongAt ?? killAt) - killAt;
        console.log(
          `PASS phase 2: reconnected + fresh pong after shim kill (~${tookMs}ms ≤ ${RECONNECT_BUDGET_MS}ms) — ${summarize(healed)}`,
        );
      } else {
        fail("phase 2: no pong within 30s after killing the shim");
      }
    }
  } finally {
    if (session) session.close();
    chrome.kill("SIGTERM");
    await delay(1000);
    if (chrome.exitCode === null) chrome.kill("SIGKILL");
    await server.close();
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    console.log("[verify] cleaned up: browser killed, profile removed, socket closed");
  }

  if (failures === 0 && chromeStderr.length) {
    const text = Buffer.concat(chromeStderr).toString("utf8");
    const native = text
      .split("\n")
      .filter((line) => /native_messag|launch_context/i.test(line))
      .slice(0, 10);
    if (native.length) console.log(`[verify] browser NM log lines:\n${native.join("\n")}`);
  }
  console.log(failures ? "\nRESULT: FAIL" : "\nRESULT: PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`RESULT: FAIL (${err.message})`);
  process.exit(1);
});
