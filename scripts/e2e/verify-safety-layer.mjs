#!/usr/bin/env node
/**
 * SP4 e2e · safety-layer verification (sensitive-domain deny + confirm card
 * + audit trail), reusing the SP3 harness pattern end-to-end:
 *
 *   POST /v1/browser/act → browser-bridge (AGX_BROWSER_BACKEND=extension)
 *     → NM unix socket → shim → extension SW
 *     → preActionHook: sensitive-domain verdict → confirm card (shadow DOM)
 *     → real executor → act_result (source:"extension", tab_url)
 *     → settle → audit line in AGX_HOME/action_audit/outbox.jsonl
 *
 * The audit emit gate mirrors the Python audit_enabled(): the e2e writes an
 * enterprise-enabled config.yaml into the throwaway AGX_HOME first, then
 * asserts the outbox lines at the end (判据 4: source=extension + tab_url).
 *
 * Assertions (SP4 plan §2):
 *   T1  domains.js pattern matching (node-level unit check)
 *   T2  open a deny-listed bank URL         → blocked: sensitive domain (no
 *       network needed — the verdict precedes tabs.create)
 *   T3  snapshot while the active tab is a deny-listed mail host (opened as a
 *       plain startup URL via --host-resolver-rules → "user opened it") → blocked
 *   T4  open the plain fixture + snapshot   → indexes all control elements
 *   T5  type into password → card appears (MutationObserver counter) → card
 *       DENY → user_declined, page untouched
 *   T6  type into password → card ALLOW     → executed, confirmed:true
 *   T7  click submit → card DENY            → user_declined, submit-count 0
 *   T8  click submit → card ALLOW           → confirmed, submit-count 1
 *   T9  click in-form plain button → card appears (deny; in-form rule)
 *   T10 click outer (form-less) button      → NO card, executes directly
 *   T11 press_key Enter, focus in form → card ALLOW → confirmed, form-key:Enter
 *   T12 press_key Enter, focus on body     → NO card, executes directly
 *   T13 options page: type+click to allow mail.qq.com → recorded in the list,
 *       the host is no longer blocked (open + snapshot succeed)
 *   T14 audit outbox: every line source=extension + tab_url; blocked /
 *       confirmed / declined / completed outcomes all present; unique event_id
 *
 * Store posture is kept: the in-repo manifest ships host_permissions:[] and
 * this harness loads a temp copy patched with <all_urls> (same as SP3 — no
 * user gesture exists in automation).
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
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { delay, waitFor, NM_HOST_NAME, SPIKE_EXTENSION_ID, urlHostname, textHasHost } from "./helpers.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DESKTOP_DIR = path.join(REPO_ROOT, "desktop");
const DIST_DIR = path.join(DESKTOP_DIR, "dist-electron");
const EXTENSION_DIR = path.join(REPO_ROOT, "extension");
const FIXTURES_DIR = path.join(REPO_ROOT, "scripts", "e2e", "fixtures");
const SHIM_PATH = path.join(REPO_ROOT, "scripts", "nm-bridge-shim.mjs");
const GOOGLE_CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE_DIR = "/tmp/agx-sp4-e2e-profile";
const DEBUG_PORT = 9225;
const SW_ONLINE_BUDGET_MS = 45_000;
/** Deny-list host mapped onto the fixture server (--host-resolver-rules). */
const DENIED_MAIL_HOST = "mail.qq.com";
/** Deny-list bank host; only ever used for URL-pattern verdicts, no network. */
const DENIED_BANK_HOST = "www.icbc.com.cn";

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
// harness (SP3 verify-action-executor.mjs pattern)
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
  const manifestPath = path.join(PROFILE_DIR, "NativeMessagingHosts", `${NM_HOST_NAME}.json`);
  const manifest = {
    name: NM_HOST_NAME,
    description: "AgenticX browser extension bridge (SP4 e2e)",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${SPIKE_EXTENSION_ID}/`],
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8" });
  console.log(`[verify] NM host installed: ${manifestPath} (socket=${socketPath})`);
}

/** Temp copy of extension/ with host_permissions patched in (store posture
 *  stays intact in the repo manifest — see SP3 §5.4 finding #1). */
function patchExtensionForAutomation(workDir) {
  const target = path.join(workDir, "extension-under-test");
  fs.cpSync(EXTENSION_DIR, target, {
    recursive: true,
    filter: (source) => path.basename(source) !== "test-extension-key.pem",
  });
  const manifestPath = path.join(target, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  // <all_urls> is the only patch: the in-repo manifest ships
  // host_permissions:[] (activeTab-only store posture — see SP3 §5.4
  // finding #1); the automation copy also drives the options page via CDP,
  // which needs no manifest grant at all.
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
      filePath = path.join(FIXTURES_DIR, "safety-page.html");
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

async function act(endpoint, label, body) {
  const t0 = Date.now();
  const reply = await postAct(endpoint, body);
  console.log(`[${label}] ${Date.now() - t0}ms ${JSON.stringify(reply).slice(0, 200)}`);
  return reply;
}

/** extract_text with a query filter and return its text ("" on failure). */
async function extractText(endpoint, session, query) {
  const reply = await postAct(endpoint, { ...session, action: "extract_text", query });
  return reply.ok === true && typeof reply.text === "string" ? reply.text : "";
}

async function cardSeenCount(endpoint, session) {
  const text = await extractText(endpoint, session, "card-seen");
  const matched = /card-seen:\s*(\d+)/.exec(text);
  return matched ? Number(matched[1]) : 0;
}

/** Poll cardSeenCount with a sane cadence (waitFor's 10ms tick would flood
 *  the bridge with extract acts — each one is also an audit line). */
async function waitForCardCount(endpoint, session, target, label) {
  return waitFor(
    async () => {
      const value = await cardSeenCount(endpoint, session);
      if (value >= target) return value;
      await delay(150);
      return null;
    },
    20_000,
    label,
  );
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

/** One-shot CDP Runtime.evaluate against a page target (node ≥22 WebSocket).
 *  Chromium forbids chrome.scripting on chrome-extension:// pages even with a
 *  host grant, so the options-page UI (T13) is driven through DevTools
 *  instead of the act protocol — a testing-only detour, no product hook. */
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
        else resolve(message.result?.result?.value);
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

// ---------------------------------------------------------------------------
// SP4 scenario
// ---------------------------------------------------------------------------

/** 判据 1 (pattern half): node-level check of the built-in deny list. */
function runDomainPatternUnitChecks() {
  const domains = require(path.join(EXTENSION_DIR, "src", "safety", "domains.js"));
  const cases = [
    [DENIED_BANK_HOST, true],
    ["icbc.com.cn", true],
    ["fake-icbc.com.cn", false],
    [DENIED_MAIL_HOST, true],
    ["www.gov.cn", true],
    ["mohrss.gov.cn", true],
    ["alipay.com", true],
    ["accounts.google.com", true],
    ["icbc.com.cn.evil.example", false],
    ["127.0.0.1", false],
    ["example.com", false],
  ];
  let bad = 0;
  for (const [host, want] of cases) {
    const hit = domains.agxMatchSensitiveDomain(host);
    if (Boolean(hit) !== want || (want && !hit.category)) {
      bad += 1;
      console.error(`  mismatch: ${host} want=${want} got=${JSON.stringify(hit)}`);
    }
  }
  assert(bad === 0, `T1 deny-list pattern matching (${cases.length} cases, ${domains.AGX_SENSITIVE_DOMAIN_PATTERNS.length} patterns)`);
  assert(
    domains.AGX_SENSITIVE_DOMAIN_PATTERNS.length >= 20,
    `T1 built-in deny list carries ~20 patterns (${domains.AGX_SENSITIVE_DOMAIN_PATTERNS.length})`,
  );
}

async function runScenario(endpoint, fixtureBase, agxHome) {
  const session = { session_id: "sp4-e2e" };
  const fixtureUrl = `${fixtureBase}/safety-page.html`;
  const bankUrl = `http://${DENIED_BANK_HOST}:${new URL(fixtureBase).port}/safety-page.html`;
  const mailUrl = `http://${DENIED_MAIL_HOST}:${new URL(fixtureBase).port}/safety-page.html`;

  // ---- 判据 1: deny-listed bank open → blocked (verdict precedes any
  // network/tab work; the bank host needs no DNS mapping at all) ----------
  const t2 = await act(endpoint, "T2 open denied bank", { ...session, action: "open", url: bankUrl });
  assert(
    t2.ok === false &&
      t2.error === "blocked: sensitive domain" &&
      t2.domain === DENIED_BANK_HOST &&
      t2.blocked === true &&
      typeof t2.tab_url === "string",
    "T2 open a deny-listed bank URL → {ok:false, error:\"blocked: sensitive domain\", domain, blocked:true}",
  );

  // ---- current-tab rule: the user's own mail tab (opened as a startup URL)
  // is deny-listed, so agent actions against it are refused ----------------
  {
    const debugTargets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
    console.log(
      `[debug] browser page targets before T3: ${JSON.stringify(
        debugTargets.filter((t) => t.type === "page").map((t) => t.url),
      )}`,
    );
  }
  const t3 = await act(endpoint, "T3 snapshot on denied mail tab", { ...session, action: "snapshot" });
  assert(
    t3.ok === false &&
      t3.error === "blocked: sensitive domain" &&
      t3.domain === DENIED_MAIL_HOST &&
      t3.blocked === true,
    `T3 active-tab deny hit (snapshot on mail.qq.com tab) → blocked: sensitive domain (got: ${JSON.stringify(t3).slice(0, 160)})`,
  );

  // ---- open the plain fixture and index the control elements -------------
  const t4open = await act(endpoint, "T4 open fixture", { ...session, action: "open", url: fixtureUrl });
  assert(t4open.ok === true, "T4 open the plain fixture page");
  const t4 = await act(endpoint, "T4 snapshot", { ...session, action: "snapshot" });
  const elements = Array.isArray(t4.elements) ? t4.elements : [];
  const findBy = (pred) => elements.find((el) => el && pred(el));
  const pwEl = findBy((el) => el.is_password === true);
  const submitEl = findBy((el) => el.tag === "button" && el.type === "submit");
  const formPlainEl = findBy((el) => el.text === "Form plain button" && el.tag === "button");
  const outerEl = findBy((el) => el.text === "Outer button" && el.tag === "button");
  const cardDenyEl = findBy((el) => el.text === "Card deny" && el.tag === "button");
  const cardAllowEl = findBy((el) => el.text === "Card allow" && el.tag === "button");
  const focusFormEl = findBy((el) => el.text === "Focus form input" && el.tag === "button");
  const focusBodyEl = findBy((el) => el.text === "Focus body" && el.tag === "button");
  assert(
    elements.length >= 9 &&
      Boolean(pwEl && submitEl && formPlainEl && outerEl && cardDenyEl && cardAllowEl && focusFormEl && focusBodyEl),
    "T4 snapshot indexes every safety-fixture control element",
  );
  assert(
    Boolean(pwEl && submitEl && formPlainEl && submitEl.in_form === true && formPlainEl.in_form === true && outerEl.in_form === false),
    "T4 snapshot elements carry the SP4 in_form flag (submit/in-form vs outer)",
  );

  // ---- 判据 2: type into password → card; DENY → not executed ------------
  const t5type = postAct(endpoint, {
    ...session,
    action: "type",
    index: pwEl?.index,
    text: "deny-me-123",
  });
  await waitForCardCount(endpoint, session, 1, "confirm card rendered (password type, deny case)");
  await act(endpoint, "T5 click card-deny hook", { ...session, action: "click", index: cardDenyEl?.index });
  const t5 = await t5type;
  assert(
    t5.ok === false && t5.error === "user_declined" && t5.confirm_outcome === "deny",
    "T5 password type + card DENY → {ok:false, error:\"user_declined\"}",
  );
  const t5pw = await extractText(endpoint, session, "pw-typed");
  assert(
    t5pw.includes("pw-typed: (none)"),
    "T5 the denied password type never touched the page (pw-typed: (none))",
  );

  // ---- 判据 2: type into password → card; ALLOW → executed + confirmed ----
  const t6type = postAct(endpoint, {
    ...session,
    action: "type",
    index: pwEl?.index,
    text: "allow-me-456",
  });
  await waitForCardCount(endpoint, session, 2, "confirm card rendered (password type, allow case)");
  await act(endpoint, "T6 click card-allow hook", { ...session, action: "click", index: cardAllowEl?.index });
  const t6 = await t6type;
  assert(
    t6.ok === true && t6.confirmed === true,
    "T6 password type + card ALLOW → executed with confirmed:true",
  );
  const t6pw = await extractText(endpoint, session, "pw-typed");
  assert(
    t6pw.includes("pw-typed: allow-me-456"),
    "T6 the allowed password type landed in the page",
  );

  // ---- click submit → card DENY / ALLOW ----------------------------------
  const t7click = postAct(endpoint, { ...session, action: "click", index: submitEl?.index });
  await waitForCardCount(endpoint, session, 3, "confirm card rendered (submit click, deny case)");
  await act(endpoint, "T7 click card-deny hook", { ...session, action: "click", index: cardDenyEl?.index });
  const t7 = await t7click;
  assert(
    t7.ok === false && t7.error === "user_declined" && t7.confirm_outcome === "deny",
    "T7 submit click → card (deny) → user_declined",
  );
  let submitCountText = await extractText(endpoint, session, "submit-count");
  assert(submitCountText.includes("submit-count: 0"), "T7 the denied submit click did not submit the form");

  const t8click = postAct(endpoint, { ...session, action: "click", index: submitEl?.index });
  await waitForCardCount(endpoint, session, 4, "confirm card rendered (submit click, allow case)");
  await act(endpoint, "T8 click card-allow hook", { ...session, action: "click", index: cardAllowEl?.index });
  const t8 = await t8click;
  assert(
    t8.ok === true && t8.confirmed === true,
    "T8 submit click → card (allow) → executed with confirmed:true",
  );
  submitCountText = await extractText(endpoint, session, "submit-count");
  assert(submitCountText.includes("submit-count: 1"), "T8 the allowed submit click submitted the form once");

  // ---- click an in-form plain button also triggers the card --------------
  const t9click = postAct(endpoint, { ...session, action: "click", index: formPlainEl?.index });
  await waitForCardCount(endpoint, session, 5, "confirm card rendered (in-form plain click, deny case)");
  await act(endpoint, "T9 click card-deny hook", { ...session, action: "click", index: cardDenyEl?.index });
  const t9 = await t9click;
  assert(
    t9.ok === false && t9.error === "user_declined",
    "T9 in-form plain button click → card (deny) → user_declined",
  );
  const t9plain = await extractText(endpoint, session, "plain-in-form");
  assert(t9plain.includes("plain-in-form: 0"), "T9 the denied in-form click never ran");

  // ---- form-less click: no card, straight through ------------------------
  const seenBeforeT10 = await cardSeenCount(endpoint, session);
  const t10 = await act(endpoint, "T10 click outer button", { ...session, action: "click", index: outerEl?.index });
  const t10count = await extractText(endpoint, session, "outer-count");
  assert(
    t10.ok === true && t10.confirmed !== true && t10count.includes("outer-count: 1"),
    "T10 form-less click executes directly (no card, no confirmed flag)",
  );
  assert(
    (await cardSeenCount(endpoint, session)) === seenBeforeT10,
    "T10 no confirm card was rendered for the form-less click",
  );

  // ---- press_key Enter inside a form → card ALLOW --------------------------
  await act(endpoint, "T11 focus form input", { ...session, action: "click", index: focusFormEl?.index });
  const t11focus = await extractText(endpoint, session, "form-focus-count");
  assert(
    t11focus.includes("form-focus-count: 1"),
    "T11 the focus helper put the caret inside the form input",
  );
  const seenBeforeT11 = await cardSeenCount(endpoint, session);
  const t11press = postAct(endpoint, { ...session, action: "press_key", key: "Enter" });
  await waitForCardCount(
    endpoint,
    session,
    seenBeforeT11 + 1,
    "confirm card rendered (Enter in form)",
  );
  await act(endpoint, "T11 click card-allow hook", { ...session, action: "click", index: cardAllowEl?.index });
  const t11 = await t11press;
  assert(
    t11.ok === true && t11.confirmed === true,
    "T11 press_key Enter (focus in form) → card (allow) → confirmed:true",
  );
  // Clicking the card hook moves the caret to the hook button, so the allowed
  // Enter is asserted on the document-level marker instead of the form one.
  const t11key = await extractText(endpoint, session, "last-key");
  assert(t11key.includes("last-key: Enter"), "T11 the allowed Enter executed (last-key: Enter)");

  // ---- press_key Enter outside any form: no card ---------------------------
  await act(endpoint, "T12 focus body", { ...session, action: "click", index: focusBodyEl?.index });
  const seenBeforeT12 = await cardSeenCount(endpoint, session);
  const t12 = await act(endpoint, "T12 press Enter on body", { ...session, action: "press_key", key: "Enter" });
  const t12key = await extractText(endpoint, session, "last-key");
  assert(
    t12.ok === true && t12.confirmed !== true && t12key.includes("last-key: Enter"),
    "T12 press_key Enter (focus on body) executes directly — no card",
  );
  assert(
    (await cardSeenCount(endpoint, session)) === seenBeforeT12,
    "T12 no confirm card was rendered for the body-focus Enter",
  );

  // ---- 判据 3: options page allows a domain → not blocked anymore ----------
  const optionsUrl = `chrome-extension://${SPIKE_EXTENSION_ID}/options.html`;
  const t13open = await act(endpoint, "T13 open options page", { ...session, action: "open", url: optionsUrl });
  assert(t13open.ok === true, "T13 the options page opens (chrome-extension:// own origin is not deny-listed)");

  // Chromium forbids chrome.scripting into chrome-extension:// pages even
  // WITH a host grant, so the real options UI is driven over CDP DevTools:
  // fill the input, click 放行该域名, read back status + rendered list.
  const pageTargets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
  const optionsTarget = pageTargets.find(
    (t) => t.type === "page" && t.url.startsWith(optionsUrl),
  );
  assert(
    Boolean(optionsTarget?.webSocketDebuggerUrl),
    "T13 the options page is reachable via the DevTools target",
  );
  const t13status = await cdpEvaluate(
    optionsTarget.webSocketDebuggerUrl,
    `(async () => {
       const input = document.getElementById("domain-input");
       input.value = ${JSON.stringify(DENIED_MAIL_HOST)};
       input.dispatchEvent(new Event("input", { bubbles: true }));
       document.getElementById("allow-btn").click();
       await new Promise((r) => setTimeout(r, 150));
       return document.getElementById("allow-status").textContent;
     })()`,
  );
  assert(
    String(t13status).includes("已放行") && textHasHost(t13status, DENIED_MAIL_HOST),
    `T13 options UI: 放行 click lands — status "${t13status}"`,
  );
  const t13list = await cdpEvaluate(
    optionsTarget.webSocketDebuggerUrl,
    `document.getElementById("allow-list").innerText`,
  );
  assert(
    textHasHost(t13list, DENIED_MAIL_HOST),
    `T13 the allowed domain is recorded in the options allow list (${DENIED_MAIL_HOST})`,
  );

  // the previously blocked mail host now goes through end-to-end
  const t13mail = await waitFor(async () => {
    const reply = await postAct(endpoint, { ...session, action: "open", url: mailUrl });
    return reply.ok === true ? reply : null;
  }, 10_000, "open the allowed mail host");
  assert(t13mail.ok === true, "T13 open the allowed mail.qq.com fixture → no longer blocked");
  const t13snap2 = await act(endpoint, "T13 snapshot allowed mail tab", { ...session, action: "snapshot" });
  assert(
    t13snap2.ok === true && Array.isArray(t13snap2.elements) && t13snap2.elements.length > 0,
    "T13 agent actions on the allowed domain execute (snapshot succeeds)",
  );

  // ---- 判据 4: audit outbox lines ------------------------------------------
  const outbox = path.join(agxHome, "action_audit", "outbox.jsonl");
  const lines = fs.existsSync(outbox)
    ? fs.readFileSync(outbox, "utf8").split("\n").filter((line) => line.trim()).map((line) => JSON.parse(line))
    : [];
  const outcomes = {};
  const eventIds = new Set();
  let sourceAndTabUrl = 0;
  for (const row of lines) {
    outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
    eventIds.add(row.event_id);
    if (row.source === "extension" && typeof row.tab_url === "string" && row.tab_url) sourceAndTabUrl += 1;
  }
  assert(lines.length >= 20, `T14 audit outbox recorded the whole run (${lines.length} lines)`);
  assert(
    lines.every((row) => row.source === "extension" && typeof row.tab_url === "string"),
    "T14 every audit line carries source=extension and the tab_url field",
  );
  const rowsWithTabUrl = lines.filter((row) => row.tab_url && row.tab_url.length > 0);
  const errorRows = lines.filter((row) => row.outcome === "error" || row.outcome === "timeout");
  assert(
    rowsWithTabUrl.length === lines.length - errorRows.length,
    `T14 every non-error audit line carries a non-empty tab_url (${rowsWithTabUrl.length}/${lines.length})`,
  );
  assert(sourceAndTabUrl >= 35, "T14 the vast majority of audit lines have source+tab_url set");
  assert(eventIds.size === lines.length, "T14 audit event_ids are unique");
  assert(
    (outcomes.blocked ?? 0) >= 2 &&
      (outcomes.confirmed ?? 0) >= 3 &&
      (outcomes.declined ?? 0) >= 3 &&
      (outcomes.completed ?? 0) >= 5,
    `T14 audit outcomes cover the run: ${JSON.stringify(outcomes)}`,
  );
  const bankBlocked = lines.find(
    (row) => row.outcome === "blocked" && urlHostname(String(row.tab_url)) === DENIED_BANK_HOST,
  );
  const mailBlocked = lines.find(
    (row) => row.outcome === "blocked" && urlHostname(String(row.tab_url)) === DENIED_MAIL_HOST,
  );
  assert(
    Boolean(bankBlocked && mailBlocked),
    "T14 the blocked audit lines name the deny-listed hosts (bank + mail tab_url)",
  );
  assert(
    lines.every((row) => row.v === 1 && row.kind === "browser_action" && /^near_browser_/.test(row.tool_name || "")),
    "T14 audit lines keep the v:1 / near_browser_* contract the uploader drains",
  );
  const confirmedRows = lines.filter((row) => row.outcome === "confirmed");
  assert(
    confirmedRows.length >= 3 && confirmedRows.every((row) => row.risk === "high"),
    "T14 confirmed actions are recorded (outcome=confirmed, risk=high)",
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
        "branded Google Chrome ignores --load-extension); SP4 safety-layer check skipped",
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
  runDomainPatternUnitChecks();

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-sp4-e2e-"));
  const fixture = await startFixtureServer();
  console.log(`[verify] fixture server: ${fixture.base}`);

  let chrome = null;
  const chromeStderr = [];
  try {
    const extensionUnderTest = patchExtensionForAutomation(workDir);
    const agxHome = path.join(workDir, "agx-home");
    fs.mkdirSync(agxHome, { recursive: true });
    // Audit gate (same condition as the Python audit_enabled()): enabled + token.
    fs.writeFileSync(
      path.join(agxHome, "config.yaml"),
      [
        "version: '1'",
        "enterprise:",
        "  enabled: true",
        "  token: sp4-e2e-audit-token",
        "  base_url: 'http://127.0.0.1:9'",
        "",
      ].join("\n"),
      "utf8",
    );
    const socketPath = path.join(workDir, "browser_bridge_nm.sock");
    installNmHostIntoProfile(socketPath);

    process.env.AGX_HOME = agxHome;
    process.env.AGX_NM_SOCKET_PATH = socketPath;
    process.env.AGX_BROWSER_BACKEND = "extension";
    delete process.env.AGX_EXT_STUB;
    const bridge = loadBridgeWithMockElectron(workDir);
    bridge.startNearBrowserBridge(() => null);
    const endpoint = await waitForBridgeFiles(agxHome);

    const fixturePort = new URL(fixture.base).port;
    console.log(`[verify] browser: ${browser.binary}`);
    chrome = spawn(
      browser.binary,
      [
        `--user-data-dir=${PROFILE_DIR}`,
        `--remote-debugging-port=${DEBUG_PORT}`,
        "--remote-allow-origins=*",
        `--load-extension=${extensionUnderTest}`,
        `--host-resolver-rules=MAP ${DENIED_MAIL_HOST} 127.0.0.1`,
        // Developer machines often run a system proxy (e.g. 127.0.0.1:7897),
        // which routes mail.qq.com to the real network and BYPASSES
        // --host-resolver-rules — the startup tab then lands on an error page.
        // Force direct connections so the mapping reaches the fixture server.
        "--no-proxy-server",
        "--no-first-run",
        "--no-default-browser-check",
        // Single startup tab: the deny-listed mail host mapped onto the
        // fixture server plays the "user opened it themselves" role (kept
        // active — a second startup tab would steal the active-tab slot).
        `http://${DENIED_MAIL_HOST}:${fixturePort}/safety-page.html`,
      ],
      { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env } },
    );
    chrome.stderr.on("data", (chunk) => chromeStderr.push(chunk));

    const swTarget = await waitForServiceWorkerTarget();
    console.log(`[verify] service worker target: ${swTarget.url}`);

    await waitFor(
      async () => (await getStatus(endpoint)).extension_online === true,
      SW_ONLINE_BUDGET_MS,
      "extension SW online (NM ping seen by the bridge)",
    );
    assert(true, "T0 real extension SW heartbeat reaches the bridge");

    await runScenario(endpoint, fixture.base, agxHome);
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
