#!/usr/bin/env node
/**
 * SP3 e2e · six-action executor verification (real browser, real pages).
 *
 * Drives the FULL SP2 pipeline for every action — no CDP shortcuts:
 *
 *   POST /v1/browser/act (agent side)
 *     → browser-bridge routing (AGX_BROWSER_BACKEND=extension)
 *     → NM unix socket → scripts/nm-bridge-shim.mjs → extension SW
 *     → real executor (chrome.scripting / captureVisibleTab / storage.session)
 *     → act_result → settle() → HTTP reply
 *
 * The harness only uses the DevTools endpoint to confirm the extension SW
 * target exists (diagnostics; actions never bypass the NM chain).
 *
 * Assertions (SP3 plan §3, automated on the fixture pages under
 * scripts/e2e/fixtures/ — form/buttons/links/shadow DOM):
 *   T1  open                  → tab created at the main fixture, title correct
 *   T2  extract_text          → full text incl. shadow-root content
 *   T3  extract_text {query}  → agent-side query-filter semantics
 *   T4  snapshot              → indexed elements (text/tag/aria/rect,
 *                               is_password, link href, shadow button)
 *   T5  click {index}         → fixture counter side effect observed via extract
 *   T6  type {index,text}     → live input preview observed via extract
 *   T7  type {submit:true}    → Enter/requestSubmit lands in the form result
 *   T8  press_key {key}       → document key listener observes the key
 *   T9  click shadow element  → shadow-root counter side effect
 *   T10 open (switch)         → second fixture page content
 *   T11 open (reuse)          → same tab_id (exact-URL tab reuse)
 *   T12 screenshot            → decodable base64 PNG (magic bytes)
 *   T13 click bad index       → {ok:false, error:"stale_index"} contract
 *   T14 AGX_EXT_STUB=1        → SP2 stub branch still honored end-to-end
 *
 * The in-repo manifest keeps the store posture (host_permissions: [], the
 * master-plan draft); automation has no user gesture to trigger activeTab,
 * so this harness loads a temp copy of extension/ with
 * host_permissions:["<all_urls>"] patched in. The "key" field is copied
 * verbatim so the extension ID (and NM allowed_origins) stay locked.
 *
 * Exit code: 0 PASS / 1 FAIL / 2 BLOCKED (no automation-capable browser —
 * SP1 finding #1: branded Google Chrome ignores --load-extension).
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
const PROFILE_DIR = "/tmp/agx-sp3-e2e-profile";
const DEBUG_PORT = 9224;
const SW_ONLINE_BUDGET_MS = 45_000;

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

function logAction(label, requestBody, reply, ms) {
  const brief = { ...reply };
  if (typeof brief.image_base64 === "string") {
    brief.image_base64 = `<${brief.image_base64.length} b64 chars>`;
  }
  if (typeof brief.text === "string" && brief.text.length > 160) {
    brief.text = `${brief.text.slice(0, 160)}…`;
  }
  console.log(`\n[${label}] request : ${JSON.stringify(requestBody)}`);
  console.log(`[${label}] response: ${JSON.stringify(brief)}`);
  console.log(`[${label}] roundtrip: ${ms}ms`);
}

// ---------------------------------------------------------------------------
// harness pieces (SP2 verify-extension-backend.mjs pattern)
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

function installNmHostIntoProfile(socketPath) {
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
    description: "AgenticX browser extension bridge (SP3 e2e)",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${SPIKE_EXTENSION_ID}/`],
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8" });
  console.log(`[verify] NM host installed: ${manifestPath} (socket=${socketPath})`);
}

/** Temp copy of extension/ with host_permissions patched in — automation has
 *  no user gesture to trigger activeTab, so scripting/captureVisibleTab need
 *  host access. The shipped manifest keeps the store posture (SP6 finalizes). */
function patchExtensionForAutomation(workDir) {
  const target = path.join(workDir, "extension-under-test");
  fs.cpSync(EXTENSION_DIR, target, {
    recursive: true,
    filter: (source) => path.basename(source) !== "test-extension-key.pem",
  });
  const manifestPath = path.join(target, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.host_permissions = ["<all_urls>"];
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`[verify] patched extension (host_permissions for automation): ${target}`);
  return target;
}

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
    let filePath = path.join(FIXTURES_DIR, urlPath);
    if (!filePath.startsWith(FIXTURES_DIR)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (urlPath === "/" || urlPath === "") {
      filePath = path.join(FIXTURES_DIR, "action-executor.html");
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

/** Post one act and log it like the agent-side roundtrip would see it. */
async function act(endpoint, label, body) {
  const t0 = Date.now();
  const reply = await postAct(endpoint, body);
  logAction(label, body, reply, Date.now() - t0);
  return reply;
}

async function waitForServiceWorkerTarget() {
  return waitFor(async () => {
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
}

// ---------------------------------------------------------------------------
// the six-action scenario
// ---------------------------------------------------------------------------

async function runScenario(endpoint, fixtureBase) {
  const mainUrl = `${fixtureBase}/action-executor.html`;
  const secondUrl = `${fixtureBase}/second-page.html`;
  const session = { session_id: "sp3-e2e" };

  // ---- open (T1) ------------------------------------------------------------
  const t1 = await act(endpoint, "T1 open", { ...session, action: "open", url: mainUrl });
  assert(
    t1.ok === true &&
      t1.action === "open" &&
      t1.url === mainUrl &&
      t1.title === "AGX Action Executor Fixture" &&
      typeof t1.tab_id === "number" &&
      t1.backend === "extension" &&
      typeof t1.request_id === "string",
    "T1 open creates the tab and settles with url/title/tab_id/backend=extension",
  );

  // ---- extract_text full (T2) -----------------------------------------------
  const t2 = await act(endpoint, "T2 extract_text", { ...session, action: "extract_text" });
  assert(
    t2.ok === true &&
      typeof t2.text === "string" &&
      t2.text.includes("welcome to the sp3 executor fixture") &&
      t2.text.includes("shadow-host-content: inside the open shadow root"),
    "T2 extract_text returns page text incl. open-shadow-root content",
  );

  // ---- extract_text query filter (T3) --------------------------------------
  const t3 = await act(endpoint, "T3 extract_text query", {
    ...session,
    action: "extract_text",
    query: "welcome",
  });
  assert(
    t3.ok === true &&
      typeof t3.text === "string" &&
      t3.text.includes("welcome to the sp3 executor fixture") &&
      !t3.text.includes("Counter:") &&
      !t3.text.includes("shadow-host-content"),
    "T3 extract_text {query} keeps only matching lines (agent-side query semantics)",
  );

  // ---- snapshot (T4) --------------------------------------------------------
  const t4 = await act(endpoint, "T4 snapshot", { ...session, action: "snapshot" });
  const elements = Array.isArray(t4.elements) ? t4.elements : null;
  const byTextTag = (text, tag) =>
    (elements ?? []).find((el) => el && el.text === text && el.tag === tag);
  const inc = elements && byTextTag("Increment", "button");
  const live = elements && byTextTag("Type here", "input");
  const email = elements && byTextTag("Email", "input");
  const submitBtn = elements && byTextTag("Submit form", "button");
  const pw = elements && (elements.find((el) => el && el.is_password === true) ?? null);
  const link = elements && byTextTag("Goto second page", "a");
  const shadowBtn = elements && byTextTag("Shadow button", "button");
  assert(elements && elements.length >= 6, `T4 snapshot returns an indexed element list (${elements?.length ?? 0} elements)`);
  assert(
    Boolean(inc && live && email && submitBtn && pw && link && shadowBtn),
    "T4 snapshot indexes button/input/password/link AND the shadow-root button",
  );
  if (elements) {
    const indexes = elements.map((el) => el?.index);
    const uniqueIndexes = new Set(indexes).size === indexes.length;
    const everyRowHasContractFields = elements.every(
      (el) =>
        el &&
        Number.isInteger(el.index) &&
        typeof el.tag === "string" &&
        typeof el.text === "string" &&
        typeof el.role === "string" &&
        typeof el.aria_label === "string" &&
        el.rect &&
        Number.isFinite(el.rect.width) &&
        Number.isFinite(el.rect.height),
    );
    assert(uniqueIndexes, "T4 element indexes are unique (click/type reference them)");
    assert(everyRowHasContractFields, "T4 every element row carries index/tag/text/role/aria_label/rect");
    assert(
      inc && inc.rect.width >= 2 && inc.rect.height >= 2,
      "T4 rect is populated for visible elements",
    );
  }
  assert(
    Boolean(link && typeof link.href === "string" && link.href.includes("second-page.html")),
    "T4 link rows keep their href",
  );

  // ---- click by index, twice (T5) -------------------------------------------
  const t5a = await act(endpoint, "T5 click #1", { ...session, action: "click", index: inc?.index });
  const t5b = await act(endpoint, "T5 click #2", { ...session, action: "click", index: inc?.index });
  const t5c = await act(endpoint, "T5 verify via extract", {
    ...session,
    action: "extract_text",
    query: "Counter",
  });
  assert(
    t5a.ok === true && t5a.action === "click" && t5b.ok === true,
    "T5 click {index} hits the Increment button (twice, snapshot cache held)",
  );
  assert(
    t5c.ok === true && typeof t5c.text === "string" && t5c.text.includes("Counter: 2"),
    "T5 fixture counter shows the side effect of both clicks (Counter: 2)",
  );

  // ---- type by index (T6) ----------------------------------------------------
  const t6 = await act(endpoint, "T6 type", {
    ...session,
    action: "type",
    index: live?.index,
    text: "hello agx",
  });
  const t6b = await act(endpoint, "T6 verify via extract", {
    ...session,
    action: "extract_text",
    query: "last-input",
  });
  assert(t6.ok === true, "T6 type {index, text} settles ok on the live input");
  assert(
    t6b.ok === true && typeof t6b.text === "string" && t6b.text.includes("last-input: hello agx"),
    "T6 typed text lands in the page (input event observed by the main world)",
  );

  // ---- type + submit (T7) ----------------------------------------------------
  const t7 = await act(endpoint, "T7 type submit", {
    ...session,
    action: "type",
    index: email?.index,
    text: "agx@example.com",
    submit: true,
  });
  const t7b = await act(endpoint, "T7 verify via extract", {
    ...session,
    action: "extract_text",
    query: "form-result",
  });
  assert(t7.ok === true, "T7 type {submit:true} settles ok");
  assert(
    t7b.ok === true &&
      typeof t7b.text === "string" &&
      t7b.text.includes("form-result: agx@example.com"),
    "T7 Enter/requestSubmit path submits the form with the typed value",
  );

  // ---- press_key (T8) -------------------------------------------------------
  const t8 = await act(endpoint, "T8 press_key", { ...session, action: "press_key", key: "k" });
  const t8b = await act(endpoint, "T8 verify via extract", {
    ...session,
    action: "extract_text",
    query: "last-key",
  });
  assert(
    t8.ok === true &&
      t8b.ok === true &&
      typeof t8b.text === "string" &&
      t8b.text.includes("last-key: k"),
    "T8 press_key {key} dispatches a KeyboardEvent the page observes",
  );

  // ---- click the shadow-root element (T9) -----------------------------------
  const t9 = await act(endpoint, "T9 click shadow", {
    ...session,
    action: "click",
    index: shadowBtn?.index,
  });
  const t9b = await act(endpoint, "T9 verify via extract", {
    ...session,
    action: "extract_text",
    query: "shadow-count",
  });
  assert(
    t9.ok === true &&
      t9b.ok === true &&
      typeof t9b.text === "string" &&
      t9b.text.includes("shadow-count: 1"),
    "T9 click {index} reaches the element inside the open shadow root",
  );

  // ---- open switch + reuse (T10/T11) ---------------------------------------
  const t10 = await act(endpoint, "T10 open second page", {
    ...session,
    action: "open",
    url: secondUrl,
  });
  const t10b = await act(endpoint, "T10 verify via extract", { ...session, action: "extract_text" });
  assert(
    t10.ok === true && t10.url === secondUrl && typeof t10.tab_id === "number",
    "T10 open switches to the second fixture page",
  );
  assert(
    t10b.ok === true &&
      typeof t10b.text === "string" &&
      t10b.text.includes("second-page-marker: navigator switched successfully"),
    "T10 the active tab content actually switched (extract_text)",
  );
  const t11 = await act(endpoint, "T11 open same URL again", {
    ...session,
    action: "open",
    url: secondUrl,
  });
  assert(
    t11.ok === true && t11.tab_id === t10.tab_id,
    "T11 open reuses the existing tab for the same exact URL (no duplicate)",
  );

  // ---- screenshot (T12) ------------------------------------------------------
  const t12 = await act(endpoint, "T12 screenshot", { ...session, action: "screenshot" });
  const png = t12.image_base64 ? Buffer.from(t12.image_base64, "base64") : null;
  assert(
    t12.ok === true && typeof t12.image_base64 === "string" && t12.image_base64.length > 100,
    "T12 screenshot settles with base64 image data",
  );
  assert(
    png !== null &&
      png.length > 8 &&
      png[0] === 0x89 &&
      png[1] === 0x50 &&
      png[2] === 0x4e &&
      png[3] === 0x47 &&
      png[4] === 0x0d &&
      png[5] === 0x0a &&
      png[6] === 0x1a &&
      png[7] === 0x0a,
    "T12 screenshot decodes to a PNG (magic bytes)",
  );

  // ---- error contract (T13) -------------------------------------------------
  const t13 = await act(endpoint, "T13 click bad index", {
    ...session,
    action: "click",
    index: 99999,
  });
  assert(
    t13.ok === false && t13.error === "stale_index",
    "T13 unknown index → {ok:false, error:\"stale_index\"} (agent prompt semantics)",
  );

  // ---- SP2 stub branch still honored (T14) ----------------------------------
  process.env.AGX_EXT_STUB = "1";
  const t14 = await act(endpoint, "T14 AGX_EXT_STUB=1", {
    ...session,
    action: "open",
    url: mainUrl,
  });
  delete process.env.AGX_EXT_STUB;
  assert(
    t14.ok === true && t14.backend === "extension" && t14.text === "[stub]" && t14.url === "about:blank",
    "T14 AGX_EXT_STUB=1 still routes the SW to the SP2 stub through the real NM chain",
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
        "branded Google Chrome ignores --load-extension); SP3 real-executor check skipped",
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

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-sp3-e2e-"));
  const fixture = await startFixtureServer();
  console.log(`[verify] fixture server: ${fixture.base}`);

  let chrome = null;
  const chromeStderr = [];
  try {
    const extensionUnderTest = patchExtensionForAutomation(workDir);
    const agxHome = path.join(workDir, "agx-home");
    const socketPath = path.join(workDir, "browser_bridge_nm.sock");
    installNmHostIntoProfile(socketPath);

    const bridge = loadBridgeWithMockElectron(workDir);
    process.env.AGX_HOME = agxHome;
    process.env.AGX_NM_SOCKET_PATH = socketPath;
    process.env.AGX_BROWSER_BACKEND = "extension";
    delete process.env.AGX_EXT_STUB; // this e2e exercises the REAL executor
    bridge.startNearBrowserBridge(() => null);
    const endpoint = await waitForBridgeFiles(agxHome);

    console.log(`[verify] browser: ${browser.binary}`);
    chrome = spawn(
      browser.binary,
      [
        `--user-data-dir=${PROFILE_DIR}`,
        `--remote-debugging-port=${DEBUG_PORT}`,
        "--remote-allow-origins=*",
        `--load-extension=${extensionUnderTest}`,
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env } },
    );
    chrome.stderr.on("data", (chunk) => chromeStderr.push(chunk));

    // Diagnostics via CDP endpoint: the SW target proves the extension loaded.
    const swTarget = await waitForServiceWorkerTarget();
    console.log(`[verify] service worker target: ${swTarget.url}`);

    // SP2 liveness: the real SW connects via NM and pings the bridge.
    await waitFor(
      async () => (await getStatus(endpoint)).extension_online === true,
      SW_ONLINE_BUDGET_MS,
      "extension SW online (NM ping seen by the bridge)",
    );
    const status = await getStatus(endpoint);
    console.log(`[verify] /v1/browser/status → ${JSON.stringify(status)}`);
    assert(status.extension_online === true, "T0 real extension SW heartbeat reaches the bridge");

    await runScenario(endpoint, fixture.base);
  } finally {
    if (chrome) {
      chrome.kill("SIGTERM");
      await delay(1000);
      if (chrome.exitCode === null) chrome.kill("SIGKILL");
    }
    fixture.server.close();
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
