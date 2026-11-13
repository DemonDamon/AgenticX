#!/usr/bin/env node
/**
 * SP5 e2e · 划词/整页注入 session verification (real browser → real NM →
 * real desktop dispatch → mock Studio), reusing the SP3/SP4 harness pattern:
 *
 *   context menu click (synthetic: native menus are not automatable — the
 *   handler itself runs for real inside the SW)
 *     → per-origin permission gate (chrome.permissions)
 *     → chrome.scripting.executeScript collection (SP3 collector reuse, 20k cap)
 *     → NM → nm-socket-server → browser-bridge dispatchInjectContext
 *     → POST /api/chat on a minimal mock Studio server
 *       (a real Studio app cannot boot inside e2e — the mock implements the
 *       two endpoints the dispatch touches; the desktop-side dispatch
 *       contract is additionally covered by desktop unit tests)
 *     → {type:"inject_context_result"} reply → SW storage marker / toast
 *
 * Assertions (SP5 plan §2 criteria):
 *   T0  real extension SW heartbeat reaches the bridge (SP2 liveness)
 *   T1  both context-menu items registered with the right contexts
 *   T2  判据1: un-granted origin → permissions.request called with ONLY that
 *       origin pattern (seam capture — native prompts are not automatable);
 *       after the grant, the selection lands in the session context WITH the
 *       source annotation, session resolved desktop-side (recency)
 *   T3  判据3: denied permission → explicit non-silent failure (storage
 *       marker + notification attempt), nothing reaches the session
 *   T4  cached active session: second inject carries session_id from the
 *       {type:"active_session"} push; no extra /api/sessions probe
 *   T5  判据2: whole-page inject on a >20k fixture → exactly 20k chars,
 *       truncation noted in the placeholder turn
 *   T6  判据4: Studio unreachable (mock server down) → inject_context_result
 *       {ok:false} → storage error marker + toast attempt, never silent
 *   T7  permission posture: the automation manifest patches BOTH test hosts
 *       as standing grants but the production flow requests per-origin —
 *       asserted via the T2 capture; repo manifest keeps
 *       optional_host_permissions (no standing <all_urls>).
 *
 * The OS-level menu click and the native permission prompt cannot be driven
 * by CDP; everything else runs for real (real tab, real executeScript, real
 * NM chain, real dispatch). The permission first-time/denied branches are
 * forced through the documented test seams in inject.js
 * (agxPermissionContainsFn / agxPermissionRequestFn, defaults = real APIs).
 *
 * Exit code: 0 PASS / 1 FAIL / 2 BLOCKED (no automation-capable browser).
 *
 * Author: Damon Li
 */

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
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
const FIXTURES_DIR = path.join(REPO_ROOT, "scripts", "e2e", "fixtures");
const SHIM_PATH = path.join(REPO_ROOT, "scripts", "nm-bridge-shim.mjs");
const GOOGLE_CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE_DIR = "/tmp/agx-sp5-e2e-profile";
const DEBUG_PORT = 9226;
const SW_ONLINE_BUDGET_MS = 45_000;
/** Standing automation grants (SP3 posture note: automation has no user
 *  gesture). The localhost grant lets the T2 "first-time" branch run its
 *  full downstream chain for real once the request seam grants it. */
const AUTOMATION_HOST_GRANTS = ["http://127.0.0.1/*", "http://localhost/*"];
const STUDIO_TOKEN = "sp5-e2e-studio-token";
const MOCK_SESSIONS = [
  { session_id: "s-old", updated_at: 1000, name: "旧会话" },
  { session_id: "s-latest", updated_at: 2000, name: "SP5 最新会话" },
];

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

// ---------------------------------------------------------------------------
// harness (SP3/SP4 pattern)
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

function installNmHostIntoProfile() {
  if (!fs.existsSync(SHIM_PATH)) throw new Error(`shim not found: ${SHIM_PATH}`);
  const wrapperPath = path.join(os.homedir(), ".agenticx", "agx-nm-bridge-host.sh");
  fs.mkdirSync(path.dirname(wrapperPath), { recursive: true });
  fs.writeFileSync(
    wrapperPath,
    `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(SHIM_PATH)} "$@"\n`,
    { encoding: "utf8", mode: 0o755 },
  );
  fs.chmodSync(wrapperPath, 0o755);
  // SP1 finding #2: NM manifests are looked up inside the --user-data-dir profile.
  const manifestPath = path.join(PROFILE_DIR, "NativeMessagingHosts", `${NM_HOST_NAME}.json`);
  const manifest = {
    name: NM_HOST_NAME,
    description: "AgenticX browser extension bridge (SP5 e2e)",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${SPIKE_EXTENSION_ID}/`],
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8" });
  console.log(`[verify] NM host installed: ${manifestPath}`);
}

/**
 * Temp copy of extension/ with the two test hosts patched as standing grants
 * (production requests per-origin at click time — the repo manifest keeps
 * optional_host_permissions, no standing <all_urls>).
 */
function patchExtensionForAutomation(workDir) {
  const target = path.join(workDir, "extension-under-test");
  fs.cpSync(EXTENSION_DIR, target, {
    recursive: true,
    filter: (source) => path.basename(source) !== "test-extension-key.pem",
  });
  const manifestPath = path.join(target, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = AUTOMATION_HOST_GRANTS;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`[verify] patched extension (host_permissions: ${AUTOMATION_HOST_GRANTS.join(", ")}): ${target}`);
  return target;
}

// ---------------------------------------------------------------------------
// fixture server (127.0.0.1 + localhost aliases) + long-page generation
// ---------------------------------------------------------------------------

// 判据2 fixture: plan-mandated 500k of text (generated, deterministic) — the
// SP3 collector caps at 24k, the SP5 handler trims to the 20k inject cap.
const LONG_TEXT = `long-page-marker: ${"L".repeat(500_000)}`;

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
    if (urlPath === "/long-page.html") {
      // 判据2 fixture: >20k of text, generated (deterministic).
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(
        `<!doctype html><html><head><meta charset="utf-8"><title>AGX Long Page Fixture</title></head>` +
          `<body><h1>long fixture</h1><pre>${LONG_TEXT}</pre></body></html>`,
      );
      return;
    }
    let filePath = path.join(FIXTURES_DIR, urlPath);
    if (!filePath.startsWith(FIXTURES_DIR)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (urlPath === "/" || urlPath === "") {
      filePath = path.join(FIXTURES_DIR, "page-inject.html");
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404).end("not found");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}` });
    });
  });
}

// ---------------------------------------------------------------------------
// minimal mock Studio server — the smallest session-mock the dispatch touches
// (SP5 plan §2 criterion 5: a full Studio app cannot boot in e2e; the desktop
// dispatch contract is independently covered by
// desktop/tests/browser-bridge-inject-context.test.ts).
// ---------------------------------------------------------------------------

function startMockStudio() {
  const state = { chats: [], sessionProbes: 0, up: true };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const url = req.url || "";
      if (!state.up || url.startsWith("/__down")) {
        res.destroy();
        return;
      }
      if (req.headers["x-agx-desktop-token"] !== STUDIO_TOKEN) {
        res.writeHead(401).end('{"ok":false}');
        return;
      }
      if (url === "/api/sessions" && req.method === "GET") {
        state.sessionProbes += 1;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true, sessions: MOCK_SESSIONS }));
        return;
      }
      if (url === "/api/chat" && req.method === "POST") {
        let row = null;
        try {
          row = JSON.parse(body);
        } catch {
          res.writeHead(400).end('{"ok":false}');
          return;
        }
        state.chats.push(row);
        // SSE like the real endpoint: the dispatch reads the first chunk and
        // cancels the stream (keep_runtime_after_disconnect keeps the turn).
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ type: "message", content: "received" })}\n\n`);
        return;
      }
      res.writeHead(404).end('{"ok":false}');
    });
  });
  const base = new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}`, state });
    });
  });
  return base;
}

// ---------------------------------------------------------------------------
// CDP helpers (node ≥22 WebSocket; SP4 pattern)
// ---------------------------------------------------------------------------

async function fetchJsonTargets() {
  const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
  if (!response.ok) return [];
  return response.json();
}

async function cdpEvaluate(wsUrl, expression) {
  const ws = new WebSocket(wsUrl);
  try {
    await new Promise((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = () => reject(new Error(`CDP socket failed: ${wsUrl}`));
    });
    return await new Promise((resolve, reject) => {
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        if (message.error) reject(new Error(message.error.message));
        else if (message.result?.exceptionDetails) {
          const details = message.result.exceptionDetails;
          reject(
            new Error(
              `evaluate threw: ${details.text} ${details.exception?.description ?? details.exception?.value ?? ""}`,
            ),
          );
        } else resolve(message.result?.result?.value);
      };
      ws.send(
        JSON.stringify({
          id: 1,
          method: "Runtime.evaluate",
          params: { expression, awaitPromise: true, returnByValue: true },
        }),
      );
    });
  } finally {
    ws.close();
  }
}

/** Evaluate inside the extension service worker. The SW target can vanish
 *  momentarily while dormant — retry the lookup (the NM port + ping alarm
 *  keep it warm, so this is cheap). The expression result is JSON-wrapped so
 *  a legitimate null/undefined is distinguishable from a transport failure. */
async function swEvaluate(expression) {
  // CodeQL (improper code sanitization): the expression is a static test
  // fixture, but it is never spliced raw into executable code — JSON-encode
  // it and let the target decode + evaluate the literal.
  const wrapped = `(async () => {
      const code = ${JSON.stringify(`(${expression})`)};
      const v = await (0, eval)(code);
      return JSON.stringify({ v });
    })()`;
  const raw = await waitFor(async () => {
    try {
      const targets = await fetchJsonTargets();
      const sw = targets.find(
        (t) => t.type === "service_worker" && t.url.startsWith(`chrome-extension://${SPIKE_EXTENSION_ID}`),
      );
      if (!sw?.webSocketDebuggerUrl) return null;
      return await cdpEvaluate(sw.webSocketDebuggerUrl, wrapped);
    } catch {
      return null;
    }
  }, 30_000, `SW evaluate: ${expression.slice(0, 60)}…`);
  return JSON.parse(raw).v;
}

/** Evaluate inside a page tab matched by url prefix. */
async function pageEvaluate(urlPrefix, expression) {
  return waitFor(async () => {
    try {
      const targets = await fetchJsonTargets();
      const page = targets.find((t) => t.type === "page" && t.url.startsWith(urlPrefix));
      if (!page?.webSocketDebuggerUrl) return null;
      return await cdpEvaluate(page.webSocketDebuggerUrl, expression);
    } catch {
      return null;
    }
  }, 30_000, `page evaluate: ${urlPrefix}`);
}

/** Open a tab from inside the SW (no host permission needed for
 *  chrome.tabs.create) and wait until it finished loading. */
async function openTabAndWait(url) {
  await swEvaluate(`chrome.tabs.create({ url: ${JSON.stringify(url)}, active: false }).then(() => "ok")`);
  await waitFor(
    async () =>
      (await swEvaluate(
        `(async () => {
           const tabs = await chrome.tabs.query({ url: ${JSON.stringify(url)} });
           return tabs.length > 0 && tabs.every((t) => t.status === "complete") ? "ready" : "";
         })()`,
      )) === "ready",
    20_000,
    `tab ready: ${url}`,
  );
  console.log(`[verify] tab ready: ${url}`);
}

/** Select the #sel-target span in the given page so the "划词" collector has
 *  a real selection to read (the native menu click is not automatable). */
async function makeSelection(urlPrefix) {
  const result = await pageEvaluate(
    urlPrefix,
    `(() => {
       const target = document.getElementById("sel-target");
       if (!target) return "NO_TARGET";
       const range = document.createRange();
       range.selectNodeContents(target);
       const sel = window.getSelection();
       sel.removeAllRanges();
       sel.addRange(range);
       return String(sel);
     })()`,
  );
  if (typeof result !== "string" || !result.includes("page-inject-selected-text")) {
    throw new Error(`selection not created in ${urlPrefix}: ${result}`);
  }
}

/** Synthetic context-menu click: runs the REAL handler on the REAL tab
 *  (exact URL — two fixture tabs can share an origin). */
async function clickMenu(menuItemId, tabUrl) {
  return swEvaluate(
    `(async () => {
       const tabs = await chrome.tabs.query({ url: ${JSON.stringify(tabUrl)} });
       if (!tabs.length) return "NO_TAB";
       await agxHandleContextMenuClick({ menuItemId: ${JSON.stringify(menuItemId)} }, tabs[0]);
       return "clicked";
     })()`,
  );
}

/** The last terminal inject record persisted by the SW (anti-silent-failure
 *  contract); null until the dispatch result arrives. */
async function readLastInjectResult() {
  const value = await swEvaluate(
    `(async () => (await chrome.storage.local.get("agx_inject_last_result")).agx_inject_last_result ?? null)()`,
  );
  return value ?? null;
}

async function waitForInjectResult(predicate, label) {
  return waitFor(async () => {
    const row = await readLastInjectResult();
    return row && predicate(row) ? row : null;
  }, 20_000, label);
}

// ---------------------------------------------------------------------------
// SP5 scenario
// ---------------------------------------------------------------------------

async function runScenario(fixtureBase, studio) {
  const localPage = `${fixtureBase.replace("127.0.0.1", "localhost")}/page-inject.html`;
  const ipPage = `${fixtureBase}/page-inject.html`;
  const longPage = `${fixtureBase}/long-page.html`;
  const chat = () => studio.state.chats;

  // ---- T1: both menu items registered -------------------------------------
  // NB: this Chrome build's chrome.contextMenus has NO getAll — inject.js
  // keeps agxInjectMenuIds, populated only from real create() callbacks.
  // SP7c: the third item (agx-copilot-selection) registers in the same flow.
  const menus = await waitFor(async () => await swEvaluate(`agxInjectMenuIds`), 10_000, "T1 menu registration");
  assert(
    JSON.stringify(menus) === JSON.stringify(["agx-inject-selection", "agx-inject-page", "agx-copilot-selection"]),
    `T1 both context-menu items registered via real create() callbacks + the SP7c 划词问 AGX item (划词: selection, 整页: page) → ${JSON.stringify(menus)}`,
  );

  // ---- T2 (判据1): un-granted origin → per-origin request → grant → full chain
  // Baseline first: the bridge's best-effort startup probe already hit
  // /api/sessions once (before the SW connected, so its push was lost — the
  // P1 self-healing path: every successful inject re-pushes).
  const probesBefore = studio.state.sessionProbes;
  await openTabAndWait(localPage);
  await makeSelection("http://localhost");
  // Force the first-time branch + capture the request (native prompts are not
  // automatable — documented seams in inject.js; defaults are the real APIs).
  await swEvaluate(`agxPermissionContainsFn = async () => false`);
  await swEvaluate(`self.__agxCapturedRequest = null`);
  await swEvaluate(
    `agxPermissionRequestFn = async (origins) => { self.__agxCapturedRequest = origins; return true; }`,
  );
  const t2click = await clickMenu("agx-inject-selection", localPage);
  assert(t2click === "clicked", `T2 synthetic 划词 menu click ran the real handler (${t2click})`);
  const t2result = await waitForInjectResult((row) => row.ok === true, "T2 inject result ok");
  assert(Boolean(t2result), "T2 dispatch reply {ok:true} reached the SW (recorded, not silent)");
  const t2captured = await swEvaluate(`self.__agxCapturedRequest`);
  assert(
    JSON.stringify(t2captured) === JSON.stringify(["http://localhost/*"]),
    `T2 permissions.request called with ONLY the site origin pattern (${JSON.stringify(t2captured)})`,
  );
  assert(chat().length === 1, `T2 exactly one chat row reached the session after the grant (got ${chat().length})`);
  const t2row = chat()[0] ?? {};
  const t2key = Object.keys(t2row.context_files ?? {})[0] ?? "";
  assert(
    t2row.session_id === "s-latest" &&
      t2key === "[来自页面 AGX Page Inject Fixture](http://localhost:" + new URL(localPage).port + "/page-inject.html)" &&
      t2row.context_files?.[t2key] === "page-inject-selected-text: hello from the agx fixture page",
    `T2 selection entered the session WITH the plan source annotation [来自页面 <title>](<url>) (key="${t2key}")`,
  );
  assert(
    typeof t2row.user_input === "string" && t2row.user_input.includes("划词") && t2row.user_input.includes(t2key),
    `T2 the placeholder user turn labels kind=划词 and the source (${JSON.stringify(t2row.user_input)})`,
  );
  assert(
    studio.state.sessionProbes === probesBefore + 1,
    `T2 session resolved desktop-side via GET /api/sessions recency (s-latest over s-old; ${studio.state.sessionProbes} probes, baseline ${probesBefore})`,
  );
  const t2active = await swEvaluate(
    `(async () => (await chrome.storage.local.get("agx_active_session")).agx_active_session ?? null)()`,
  );
  assert(
    t2active?.session_id === "s-latest",
    `T2 {type:"active_session"} push cached the target session in the SW storage (${JSON.stringify(t2active)})`,
  );

  // ---- T3 (判据3): denied permission → explicit failure, nothing sent -----
  await swEvaluate(`agxPermissionContainsFn = async () => false`);
  await swEvaluate(
    `agxPermissionRequestFn = async (origins) => { self.__agxCapturedRequest = origins; return false; }`,
  );
  const t3click = await clickMenu("agx-inject-selection", localPage);
  assert(t3click === "clicked", `T3 synthetic 划词 click on the denied branch ran (${t3click})`);
  const t3result = await waitForInjectResult(
    (row) => row.ok === false && row.error === "permission_denied",
    "T3 permission_denied recorded",
  );
  assert(
    Boolean(t3result) && t3result.origin === "http://localhost/*" && typeof t3result.notified === "boolean",
    `T3 denial is NOT silent: storage marker + toast attempt (${JSON.stringify(t3result)})`,
  );
  assert(chat().length === 1, `T3 the denied send never reached the session (still ${chat().length} row)`);

  // ---- T4: cached active session → payload carries session_id --------------
  await swEvaluate(`agxPermissionContainsFn = (origins) => chrome.permissions.contains({ origins })`);
  await swEvaluate(
    `agxPermissionRequestFn = (origins) => chrome.permissions.request({ origins })`,
  );
  await openTabAndWait(ipPage);
  await makeSelection("http://127.0.0.1");
  const t4click = await clickMenu("agx-inject-selection", ipPage);
  assert(t4click === "clicked", `T4 synthetic 划词 click with the real granted origin ran (${t4click})`);
  const t4result = await waitForInjectResult(
    (row) => row.ok === true && row.session_id === "s-latest",
    "T4 inject result ok with the cached session",
  );
  assert(Boolean(t4result), `T4 the cached active session (s-latest) was used (${JSON.stringify(t4result)})`);
  assert(chat().length === 2, `T4 second selection reached the session (${chat().length} rows)`);
  const t4row = chat()[1] ?? {};
  assert(
    t4row.session_id === "s-latest" && studio.state.sessionProbes === probesBefore + 1,
    `T4 the payload carried session_id from storage — no extra /api/sessions probe (${studio.state.sessionProbes} probes, still baseline ${probesBefore} + 1 from T2)`,
  );

  // ---- T5 (判据2): whole-page inject on a >20k page → exactly 20k chars ----
  await openTabAndWait(longPage);
  const t5click = await clickMenu("agx-inject-page", longPage);
  assert(t5click === "clicked", `T5 synthetic 整页 menu click ran (${t5click})`);
  const t5result = await waitForInjectResult((row) => row.ok === true && chat().length >= 3, "T5 page inject settled");
  assert(Boolean(t5result), "T5 whole-page inject settled ok");
  const t5row = chat()[2] ?? {};
  const t5key = Object.keys(t5row.context_files ?? {})[0] ?? "";
  const t5text = t5row.context_files?.[t5key] ?? "";
  assert(
    t5key === "[来自页面 AGX Long Page Fixture](" + longPage + ")" &&
      t5text.length === 20_000 &&
      t5text.startsWith("long fixture") &&
      t5text.includes("long-page-marker: L"),
    `T5 whole-page text trimmed to the 20k cap exactly (${t5text.length} chars, key="${t5key}")`,
  );
  assert(
    typeof t5row.user_input === "string" && t5row.user_input.includes("整页") && t5row.user_input.includes("已裁剪"),
    `T5 kind=整页 + truncation noted in the placeholder turn (${JSON.stringify(t5row.user_input)})`,
  );

  // ---- T6 (判据4): Studio unreachable → explicit toast + marker -----------
  console.log("[verify] killing the mock Studio server (session-unreachable case) …");
  await new Promise((resolve) => {
    studio.server.close(resolve);
    studio.server.closeAllConnections?.();
  });
  studio.state.up = false;
  const t6click = await clickMenu("agx-inject-selection", ipPage);
  assert(t6click === "clicked", `T6 synthetic 划词 click with Studio down ran (${t6click})`);
  const t6result = await waitForInjectResult(
    (row) => row.ok === false && row.error === "studio_unreachable",
    "T6 studio_unreachable recorded",
  );
  assert(
    Boolean(t6result) && typeof t6result.notified === "boolean",
    `T6 Studio unreachable → "AGX 未运行" toast attempt + storage error marker, not a silent drop (${JSON.stringify(t6result)})`,
  );

  // ---- T7: production manifest posture (no standing host grant) -----------
  const repoManifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf8"));
  assert(
    (!Array.isArray(repoManifest.host_permissions) || repoManifest.host_permissions.length === 0) &&
      JSON.stringify(repoManifest.optional_host_permissions).includes("<all_urls>"),
    `T7 repo manifest keeps the store posture (no standing host grant; optional_host_permissions for per-site requests)`,
  );
  assert(
    repoManifest.permissions.includes("contextMenus"),
    "T7 contextMenus permission present in the repo manifest",
  );
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const browser = resolveBrowser();
  if (!browser || browser.kind !== "chrome_for_testing") {
    console.log(
      "BLOCKED: automation needs playwright's Chrome for Testing (SP1 finding #1: " +
        "branded Google Chrome ignores --load-extension); SP5 page-inject check skipped",
    );
    process.exit(2);
  }
  if (fs.existsSync(PROFILE_DIR)) {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  }
  if (await isDebugPortTaken()) {
    throw new Error(`port ${DEBUG_PORT} already serves a DevTools endpoint — stop it first`);
  }

  buildDesktop();

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-sp5-e2e-"));
  const fixture = await startFixtureServer();
  const studio = await startMockStudio();
  console.log(`[verify] fixture server: ${fixture.base}`);
  console.log(`[verify] mock studio: ${studio.base}`);

  let chrome = null;
  const chromeStderr = [];
  try {
    const extensionUnderTest = patchExtensionForAutomation(workDir);
    const agxHome = path.join(workDir, "agx-home");
    const socketPath = path.join(workDir, "browser_bridge_nm.sock");
    installNmHostIntoProfile();

    process.env.AGX_HOME = agxHome;
    process.env.AGX_NM_SOCKET_PATH = socketPath;
    delete process.env.AGX_EXT_STUB;
    const bridge = loadBridgeWithMockElectron(workDir);
    bridge.startNearBrowserBridge(() => null, {
      // SP5: the SAME studio getters main.ts passes — pointed at the mock.
      injectContextStudio: { url: () => studio.base, token: () => STUDIO_TOKEN },
    });
    const portFile = path.join(agxHome, "browser_bridge.port");
    const tokenFile = path.join(agxHome, "browser_bridge.token");
    const endpoint = await waitFor(() => {
      try {
        const port = Number(fs.readFileSync(portFile, "utf8").trim());
        const token = fs.readFileSync(tokenFile, "utf8").trim();
        return Number.isInteger(port) && token ? { base: `http://127.0.0.1:${port}`, token } : null;
      } catch {
        return null;
      }
    }, 5_000, "bridge port/token files");

    console.log(`[verify] browser: ${browser.binary}`);
    chrome = spawn(
      browser.binary,
      [
        `--user-data-dir=${PROFILE_DIR}`,
        `--remote-debugging-port=${DEBUG_PORT}`,
        "--remote-allow-origins=*",
        `--load-extension=${extensionUnderTest}`,
        "--no-proxy-server",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env } },
    );
    chrome.stderr.on("data", (chunk) => chromeStderr.push(chunk));

    await waitFor(async () => {
      try {
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
      } catch {
        return null;
      }
    }, 30_000, `extension service worker target (chrome-extension://${SPIKE_EXTENSION_ID})`);

    await waitFor(
      async () => {
        const res = await fetch(`${endpoint.base}/v1/browser/status`, {
          headers: { Authorization: `Bearer ${endpoint.token}` },
        });
        const status = await res.json();
        return status.extension_online === true;
      },
      SW_ONLINE_BUDGET_MS,
      "extension SW online (NM ping seen by the bridge)",
    );
    assert(true, "T0 real extension SW heartbeat reaches the bridge");

    await runScenario(fixture.base, studio);
  } finally {
    if (chrome) {
      chrome.kill("SIGTERM");
      await delay(1000);
      if (chrome.exitCode === null) chrome.kill("SIGKILL");
    }
    fixture.server.close();
    studio.server.closeAllConnections?.();
    studio.server.close(() => {});
    try {
      const bridge = require(path.join(DIST_DIR, "browser-bridge.js"));
      bridge.stopNearBrowserBridge?.();
    } catch {
      /* bridge never started */
    }
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
    fs.rmSync(workDir, { recursive: true, force: true });
    if (chromeStderr.length) {
      const text = Buffer.concat(chromeStderr).toString("utf8");
      const native = text
        .split("\n")
        .filter((line) => /native_messag|load_extension/i.test(line))
        .slice(0, 10);
      if (native.length) console.log(`[verify] browser NM/extension log lines:\n${native.join("\n")}`);
    }
    console.log("[verify] cleaned up: browser killed, profile removed, bridge stopped");
  }

  console.log(failures ? `\nRESULT: FAIL (${failures})` : "\nRESULT: PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`RESULT: FAIL (${err.message})`);
  process.exit(1);
});
