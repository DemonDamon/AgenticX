#!/usr/bin/env node
/**
 * Final-delivery e2e · user-journey verification (J1–J6), chaining the
 * SP1–SP5 harnesses into ONE real-browser session against ONE bridge.
 *
 * Journeys (mirror scripts/e2e/USER-JOURNEYS.md):
 *   J1 首次安装与连接    — NM host installed → Chrome loads the extension →
 *                         popup renders "connected" + RTT (storage nm state).
 *   J2 日常划词          — select text on a page → context-menu 划词 →
 *                         first-time per-origin permission → text lands in the
 *                         AGX session WITH the [来自页面 …] source key.
 *   J3 整页阅读          — context-menu 整页 on a 500k-char page → exactly
 *                         20k chars injected, truncation noted.
 *   J4 指令驱动浏览器    — agent POST /v1/browser/act drives all six actions
 *                         on the real fixture pages (open/extract/snapshot/
 *                         click/type/press_key/screenshot), results回填.
 *   J5 安全场景          — open a deny-listed bank URL → blocked; type into a
 *                         password → confirm card → deny/allow; audit rows.
 *   J6 异常场景          — desktop (bridge) stopped → menu inject surfaces
 *                         "AGX 未运行"; bridge restart → SW self-heals;
 *                         SIGKILL the NM shim → fresh pong within 30s.
 *
 * Harness reuse (SP1–SP5 patterns, no new low-level drivers):
 *   - helpers.mjs: nmSocketPath/delay/waitFor/NM_HOST_NAME/SPIKE_EXTENSION_ID
 *   - SP1 verify-nm-channel.mjs: NM manifest inside --user-data-dir profile,
 *     shim-pid kill + fresh-pong poll (J6), SW-target CDP re-resolve
 *   - SP2/SP3: compiled desktop bridge under a mock electron module,
 *     port/token files, POST /v1/browser/act as the agent-equivalent entry
 *   - SP4: confirm-card fixture hooks + card-seen MutationObserver counter,
 *     audit outbox (AGX_HOME/action_audit/outbox.jsonl) assertions
 *   - SP5: mock Studio server, synthetic context-menu click inside the real
 *     SW (native menus are not CDP-automatable), permission test seams
 *     (agxPermissionContainsFn/agxPermissionRequestFn — defaults are the
 *     real chrome.permissions APIs), long-page 20k trim fixture
 *
 * Known pitfalls honored (SP plan §5 findings): --no-proxy-server (system
 * proxy bypasses --host-resolver-rules), NM manifest under the
 * --user-data-dir profile, SW cold-start must stay undisturbed (zero CDP
 * traffic until the bridge sees the heartbeat, then ONE persistent DevTools
 * session — SP1 createCdpSession; per-evaluate connect/close churn kills the
 * SW mid-boot), branded Google Chrome ignores --load-extension → Chrome for
 * Testing, temp extension copy patched with <all_urls> standing grant so the
 * gesture-less harness can screenshot (repo manifest keeps the store posture).
 *
 * Exit code: 0 PASS / 1 FAIL / 2 BLOCKED (no automation-capable browser).
 *
 * Author: Damon Li
 */

import { spawn, spawnSync, execFileSync } from "node:child_process";
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
const PROFILE_DIR = "/tmp/agx-uj-e2e-profile";
const DEBUG_PORT = 9227;
const SW_ONLINE_BUDGET_MS = 45_000;
/**
 * SP3/SP4 posture：临时扩展副本带 <all_urls> 常驻授权（六 action 里
 * near_browser_screenshot 的 captureVisibleTab 必须要 <all_urls> 或
 * activeTab，自动化无手势拿不到 activeTab；SP5 的 localhost 窄授权撑不起
 * 截图）。仓库正式 manifest 保持申请制姿势不动。
 */
const AUTOMATION_HOST_GRANTS = ["<all_urls>"];
const STUDIO_TOKEN = "uj-e2e-studio-token";
const MOCK_SESSIONS = [
  { session_id: "s-old", updated_at: 1000, name: "旧会话" },
  { session_id: "s-latest", updated_at: 2000, name: "用户当前活跃会话" },
];
/** J5: deny-list bank host; only used for URL-pattern verdicts, no network. */
const DENIED_BANK_HOST = "www.icbc.com.cn";
/** J6 self-heal budget: sw.js backoff ceiling is 30s (+scheduling margin). */
const HEAL_BUDGET_MS = 32_000;

const require = createRequire(import.meta.url);

// ---------------------------------------------------------------------------
// journey/assertion bookkeeping → the summary table
// ---------------------------------------------------------------------------

const journeys = [];
let current = null;

function beginJourney(id, title) {
  current = { id, title, assertions: 0, pass: 0, fail: 0, startedAt: Date.now(), rttMs: null };
  journeys.push(current);
  console.log(`\n${"=".repeat(76)}\n旅程 ${id} · ${title}\n${"=".repeat(76)}`);
}

function assert(condition, label) {
  current.assertions += 1;
  if (condition) {
    current.pass += 1;
    console.log(`PASS ${label}`);
  } else {
    current.fail += 1;
    console.error(`FAIL ${label}`);
  }
}

/** Capture the SW-reported NM RTT at journey end (popup-visible metric). */
async function journeyEnd() {
  try {
    const nm = await swStorageGet("nm");
    current.rttMs = typeof nm?.lastRttMs === "number" ? nm.lastRttMs : null;
  } catch {
    current.rttMs = null;
  }
  current.elapsedMs = Date.now() - current.startedAt;
  console.log(
    `[journey ${current.id}] ${current.pass}/${current.assertions} 断言通过，` +
      `耗时 ${current.elapsedMs}ms，NM RTT ${current.rttMs ?? "-"}ms`,
  );
}

/**
 * Run one journey; a thrown error (timeout etc.) records an explicit FAIL
 * assertion instead of aborting the whole run — the summary table stays
 * complete and no journey is ever silently skipped.
 */
async function runJourney(id, fn, ...args) {
  try {
    await fn(...args);
  } catch (err) {
    if (!current || current.id !== id) {
      beginJourney(id, "（前置失败）");
    }
    assert(false, `${id} 旅程执行异常中断: ${err.message}`);
    try {
      await journeyEnd();
    } catch {
      current.elapsedMs = Date.now() - current.startedAt;
    }
  }
}

// ---------------------------------------------------------------------------
// harness pieces (SP2/SP3/SP4/SP5 verify-*.mjs patterns verbatim)
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
    "utf-8",
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

/** SP1 finding #2: NM manifests are looked up inside the --user-data-dir
 *  profile, not the machine-level Chrome dir. */
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
    description: "AgenticX browser extension bridge (user-journey e2e)",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${SPIKE_EXTENSION_ID}/`],
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  console.log(`[verify] NM host installed: ${manifestPath} (socket=${socketPath})`);
}

/** Temp copy of extension/ with the two fixture hosts as standing grants
 *  (SP5 posture: production requests per-origin at click time). */
function patchExtensionForAutomation(workDir) {
  const target = path.join(workDir, "extension-under-test");
  fs.cpSync(EXTENSION_DIR, target, {
    recursive: true,
    filter: (source) => path.basename(source) !== "test-extension-key.pem",
  });
  const manifestPath = path.join(target, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  manifest.host_permissions = AUTOMATION_HOST_GRANTS;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf-8");
  console.log(`[verify] patched extension (host_permissions: ${AUTOMATION_HOST_GRANTS.join(", ")}): ${target}`);
  return target;
}

// ---------------------------------------------------------------------------
// fixture server (127.0.0.1 + localhost alias) + long-page + mock Studio
// ---------------------------------------------------------------------------

const LONG_TEXT = `long-page-marker: ${"L".repeat(500_000)}`;

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
    if (urlPath === "/long-page.html") {
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

/** SP5 pattern: minimal mock Studio — the two endpoints the dispatch touches. */
function startMockStudio() {
  const state = { chats: [], sessionProbes: 0, up: true };
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const url = req.url || "";
      if (!state.up) {
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
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        res.write(`data: ${JSON.stringify({ type: "message", content: "received" })}\n\n`);
        return;
      }
      res.writeHead(404).end('{"ok":false}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, base: `http://127.0.0.1:${server.address().port}`, state });
    });
  });
}

// ---------------------------------------------------------------------------
// agent-side bridge client (SP2/SP3 pattern)
// ---------------------------------------------------------------------------

function readBridgeFiles(agxHome) {
  try {
    const port = Number(fs.readFileSync(path.join(agxHome, "browser_bridge.port"), "utf-8").trim());
    const token = fs.readFileSync(path.join(agxHome, "browser_bridge.token"), "utf-8").trim();
    return Number.isInteger(port) && token ? { base: `http://127.0.0.1:${port}`, token } : null;
  } catch {
    return null;
  }
}

async function waitForBridgeFiles(agxHome) {
  return waitFor(() => readBridgeFiles(agxHome), 5_000, "bridge port/token files");
}

async function postAct(endpoint, body) {
  const res = await fetch(`${endpoint.base}/v1/browser/act`, {
    method: "POST",
    headers: { Authorization: `Bearer ${endpoint.token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return await res.json();
}

async function getStatus(endpoint) {
  const res = await fetch(`${endpoint.base}/v1/browser/status`, {
    headers: { Authorization: `Bearer ${endpoint.token}` },
  });
  return await res.json();
}

async function act(endpoint, label, body) {
  const t0 = Date.now();
  const reply = await postAct(endpoint, body);
  const brief = { ...reply };
  if (typeof brief.image_base64 === "string") brief.image_base64 = `<${brief.image_base64.length} b64 chars>`;
  if (typeof brief.text === "string" && brief.text.length > 120) brief.text = `${brief.text.slice(0, 120)}…`;
  console.log(`  [${label}] ${Date.now() - t0}ms ${JSON.stringify(brief)}`);
  return reply;
}

/** extract_text {query} → text ("" on failure) — observable readback. */
async function extractText(endpoint, session, query) {
  const reply = await postAct(endpoint, { ...session, action: "extract_text", query });
  return reply.ok === true && typeof reply.text === "string" ? reply.text : "";
}

// ---------------------------------------------------------------------------
// CDP helpers — SP1 createCdpSession pattern（关键：持久会话）
//
// SP1 实测结论：对 SW 的 DevTools attach 必须是「一条持久连接」，evaluate
// 全部复用；每次 evaluate 都新开 WebSocket 又立刻关闭会在 SW 冷启动窗口
// 反复触发「检查器脱离即停止」，SW 连 sw.js 底部的 connect()/alarms.create
// 都没跑到就被杀，之后再也不唤醒（无 alarm 无事件）。持久 attach 同时让
// SW 在 J6 断链场景下保持存活，便于观察 storage 状态；SW 真被回收时连接
// 断开，下一次 evaluate 自动按 /json 重新解析目标（SP1 原话：a dead/
// broken connection is re-resolved from /json on the next poll）。
// ---------------------------------------------------------------------------

const CDP_EVALUATE_TIMEOUT_MS = 8_000;

function connectCdp(wsUrl, label) {
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
      if (message.method === "Runtime.consoleAPICalled") {
        const text = message.params.args
          .map((arg) => arg.value ?? arg.description ?? "")
          .join(" ")
          .slice(0, 200);
        console.log(`[${label} console:${message.params.type}] ${text}`);
        return;
      }
      if (message.method === "Runtime.exceptionThrown") {
        console.log(`[${label} exception]`, JSON.stringify(message.params.exceptionDetails).slice(0, 300));
        return;
      }
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

/** CDP session that survives SW/page target recycling. */
function createCdpSession(findTarget, label) {
  let cdp = null;
  let broken = true;
  return {
    close() {
      if (cdp) cdp.close();
      cdp = null;
      broken = true;
    },
    async evaluate(expression) {
      if (!cdp || broken) {
        if (cdp) cdp.close();
        cdp = null;
        const target = await waitFor(findTarget, 30_000, `${label} target`);
        cdp = await connectCdp(target.webSocketDebuggerUrl, label);
        // 启用 console 事件流（诊断 + 观察 SW 自身日志）
        await withTimeout(cdp.send("Runtime.enable", {}), CDP_EVALUATE_TIMEOUT_MS, `Runtime.enable ${label}`).catch(
          (err) => console.log(`[verify] Runtime.enable hiccup (${label}): ${err.message}`),
        );
        broken = false;
      }
      try {
        const result = await withTimeout(
          cdp.send("Runtime.evaluate", {
            expression,
            awaitPromise: true,
            returnByValue: true,
          }),
          CDP_EVALUATE_TIMEOUT_MS,
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

async function fetchJsonTargets() {
  try {
    const response = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`);
    if (!response.ok) return [];
    return await response.json();
  } catch {
    // 浏览器/调试端口尚在启动 → 视为无目标，waitFor 下一轮再试
    return [];
  }
}

const findSwTarget = async () => {
  const targets = await fetchJsonTargets();
  return (
    targets.find(
      (t) =>
        t.type === "service_worker" &&
        t.url.startsWith(`chrome-extension://${SPIKE_EXTENSION_ID}`),
    ) ?? null
  );
};

const findPageTarget = (urlPrefix) => async () => {
  const targets = await fetchJsonTargets();
  return (
    targets.find((t) => t.type === "page" && t.url.startsWith(urlPrefix)) ?? null
  );
};

/** Evaluate inside the extension SW via ONE persistent session. */
const swSession = createCdpSession(findSwTarget, "extension SW");

async function swEvaluate(expression) {
  const wrapped = `(async () => { const v = await (${expression}); return JSON.stringify({ v }); })()`;
  const raw = await waitFor(() => swSession.evaluate(wrapped), 30_000, `SW evaluate: ${expression.slice(0, 50)}…`);
  return JSON.parse(raw).v;
}

const pageSessions = new Map();

/** Evaluate inside a page tab matched by url prefix (persistent per-prefix session). */
async function pageEvaluate(urlPrefix, expression) {
  if (!pageSessions.has(urlPrefix)) {
    pageSessions.set(urlPrefix, createCdpSession(findPageTarget(urlPrefix), `page ${urlPrefix}`));
  }
  return waitFor(
    () => pageSessions.get(urlPrefix).evaluate(expression),
    30_000,
    `page evaluate: ${urlPrefix}`,
  );
}

async function swStorageGet(key) {
  return swEvaluate(
    `(async () => (await chrome.storage.local.get(${JSON.stringify(key)}))[${JSON.stringify(key)}] ?? null)()`,
  );
}

/** Open a tab from inside the SW (chrome.tabs.create needs no host grant). */
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

/** Select the #sel-target span so the 划词 collector has a real selection. */
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

/** Synthetic context-menu click: runs the REAL handler on the REAL tab. */
async function clickMenu(menuItemId, tabUrl) {
  const out = await swEvaluate(
    `(async () => {
       const tabs = await chrome.tabs.query({ url: ${JSON.stringify(tabUrl)} });
       if (!tabs.length) return "NO_TAB";
       await agxHandleContextMenuClick({ menuItemId: ${JSON.stringify(menuItemId)} }, tabs[0]);
       return "clicked";
     })()`,
  );
  if (out !== "clicked") throw new Error(`menu click failed (${menuItemId}): ${out}`);
}

/** Last terminal inject record persisted by the SW (anti-silent-failure). */
async function waitForInjectResult(predicate, label) {
  return waitFor(async () => {
    const row = await swEvaluate(
      `(async () => (await chrome.storage.local.get("agx_inject_last_result")).agx_inject_last_result ?? null)()`,
    );
    return row && predicate(row) ? row : null;
  }, 20_000, label);
}

/** SP4 pattern: the safety fixture's MutationObserver counts card renders. */
async function cardSeenCount(endpoint, session) {
  const text = await extractText(endpoint, session, "card-seen");
  const matched = /card-seen:\s*(\d+)/.exec(text);
  return matched ? Number(matched[1]) : 0;
}

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

/** SP1 pattern: SIGKILL the NM shim processes (port stays up on the bridge). */
function findShimPids() {
  try {
    const out = execFileSync("pgrep", ["-f", "scripts/nm-bridge-shim.mjs"], { encoding: "utf8" });
    return out
      .split("\n")
      .map((line) => Number(line.trim()))
      .filter((pid) => Number.isInteger(pid) && pid > 0 && pid !== process.pid);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// J1 · 首次安装与连接
// ---------------------------------------------------------------------------

async function journeyJ1(endpoint) {
  beginJourney("J1", "首次安装与连接（装 NM host → 加载扩展 → popup 显示 connected + RTT）");

  const nm = await waitFor(async () => {
    const row = await swStorageGet("nm");
    return row && row.status === "connected" && typeof row.lastRttMs === "number" ? row : null;
  }, 30_000, "SW nm.status=connected with RTT");
  assert(
    Boolean(nm) && typeof nm.lastRttMs === "number" && nm.lastRttMs >= 0,
    `J1-a NM 通道建立：SW 经 connectNative 连上并记录 pong RTT（lastRttMs=${nm?.lastRttMs}ms）`,
  );

  const status = await getStatus(endpoint);
  assert(
    status.ok === true && status.extension_online === true,
    `J1-b desktop 侧看到扩展心跳（/v1/browser/status extension_online=true, backend=${status.backend}）`,
  );

  // popup 页作为 tab 打开（与真人点开 popup 看到的是同一渲染逻辑/同一份 storage）
  const popupUrl = `chrome-extension://${SPIKE_EXTENSION_ID}/src/popup.html`;
  const opened = await act(endpoint, "open popup", { session_id: "uj-e2e", action: "open", url: popupUrl });
  assert(opened.ok === true && typeof opened.tab_id === "number", "J1-c popup 页可打开（chrome-extension:// 自有 origin）");
  const rendered = await pageEvaluate(popupUrl, `(() => ({
       status: document.getElementById("status")?.textContent ?? "",
       rtt: document.getElementById("rtt")?.textContent ?? "",
       cls: document.getElementById("status")?.className ?? "",
     }))()`);
  assert(
    rendered?.status === "connected" && /^\d+(\.\d+)? ms$/.test(String(rendered?.rtt ?? "")) && String(rendered?.cls).includes("ok"),
    `J1-d popup 显示 connected + RTT（status="${rendered?.status}", rtt="${rendered?.rtt}"）`,
  );
  await journeyEnd();
}

// ---------------------------------------------------------------------------
// J2 · 日常划词
// ---------------------------------------------------------------------------

async function journeyJ2(fixtureBase, studio) {
  beginJourney("J2", "日常划词（选中文字 → 右键「划词发给 AGX」→ 首次权限 → 内容带来源进入 session）");
  const localPage = `${fixtureBase.replace("127.0.0.1", "localhost")}/page-inject.html`;
  const chat = () => studio.state.chats;

  const menus = await waitFor(async () => await swEvaluate(`agxInjectMenuIds`), 10_000, "菜单注册");
  assert(
    JSON.stringify(menus) === JSON.stringify(["agx-inject-selection", "agx-inject-page", "agx-copilot-selection"]),
    `J2-a 三个右键菜单项已注册（划词/整页 + SP7c 划词问 AGX，${JSON.stringify(menus)}）`,
  );

  await openTabAndWait(localPage);
  await makeSelection("http://localhost");

  // 首次权限分支：原生权限弹窗不可自动化 → 用 inject.js 的测试缝强制
  // "未授权→申请" 路径并捕获请求参数（默认是真实 chrome.permissions API）
  await swEvaluate(`agxPermissionContainsFn = async () => false`);
  await swEvaluate(`self.__agxCapturedRequest = null`);
  await swEvaluate(
    `agxPermissionRequestFn = async (origins) => { self.__agxCapturedRequest = origins; return true; }`,
  );
  await clickMenu("agx-inject-selection", localPage);
  const result = await waitForInjectResult((row) => row.ok === true, "J2 划词 dispatch 回包 ok");
  assert(Boolean(result), "J2-b 划词发送成功且结果被记录（非静默）");

  const captured = await swEvaluate(`self.__agxCapturedRequest`);
  assert(
    JSON.stringify(captured) === JSON.stringify(["http://localhost/*"]),
    `J2-c 首次权限弹窗只申请当前站点 origin（${JSON.stringify(captured)}，无 <all_urls>）`,
  );

  const row = chat()[0] ?? {};
  const key = Object.keys(row.context_files ?? {})[0] ?? "";
  const expectedKey = `[来自页面 AGX Page Inject Fixture](${localPage})`;
  assert(
    row.session_id === "s-latest" && key === expectedKey,
    `J2-d 内容进入用户当前活跃 session 且带来源标注（session=${row.session_id}，key="${key}"）`,
  );
  assert(
    row.context_files?.[key] === "page-inject-selected-text: hello from the agx fixture page",
    "J2-e 注入的正文就是用户选中的文字",
  );
  assert(
    typeof row.user_input === "string" && row.user_input.includes("划词") && row.user_input.includes(key),
    `J2-f 占位 turn 标注 kind=划词 与来源（${JSON.stringify(row.user_input)}）`,
  );

  // 恢复真实权限 API（后续旅程走常驻授权直通）
  await swEvaluate(`agxPermissionContainsFn = (origins) => chrome.permissions.contains({ origins })`);
  await swEvaluate(`agxPermissionRequestFn = (origins) => chrome.permissions.request({ origins })`);
  await journeyEnd();
}

// ---------------------------------------------------------------------------
// J3 · 整页阅读
// ---------------------------------------------------------------------------

async function journeyJ3(fixtureBase, studio) {
  beginJourney("J3", "整页阅读（右键「整页发给 AGX」→ 500k 超长页面正确裁剪）");
  const longPage = `${fixtureBase}/long-page.html`;
  const chat = () => studio.state.chats;
  const rowsBefore = chat().length;

  await openTabAndWait(longPage);
  await clickMenu("agx-inject-page", longPage);
  const result = await waitForInjectResult(
    (row) => row.ok === true && chat().length >= rowsBefore + 1,
    "J3 整页 dispatch 回包 ok",
  );
  assert(Boolean(result), "J3-a 整页发送成功且结果被记录");

  const row = chat()[chat().length - 1] ?? {};
  const key = Object.keys(row.context_files ?? {})[0] ?? "";
  const text = row.context_files?.[key] ?? "";
  assert(
    key === `[来自页面 AGX Long Page Fixture](${longPage})`,
    `J3-b 注入块带来源标注（key="${key}"）`,
  );
  assert(
    text.length === 20_000 && text.startsWith("long fixture") && text.includes("long-page-marker: L"),
    `J3-c 超长页面裁剪为恰好 20k 字符（实际 ${text.length}）`,
  );
  assert(
    typeof row.user_input === "string" && row.user_input.includes("整页") && row.user_input.includes("已裁剪"),
    `J3-d 占位 turn 标注 整页 +（超长已裁剪）（${JSON.stringify(row.user_input)}）`,
  );
  await journeyEnd();
}

// ---------------------------------------------------------------------------
// J4 · 指令驱动浏览器（agent 侧视角，六 action 全链路）
// ---------------------------------------------------------------------------

async function journeyJ4(endpoint, fixtureBase) {
  beginJourney("J4", "指令驱动浏览器（对 AGX 说「打开页面/提取标题/帮我填表/截图」→ near_browser_* 六 action）");
  const session = { session_id: "uj-e2e-agent" };
  const mainUrl = `${fixtureBase}/action-executor.html`;

  // 「打开 XX 页面并提取标题」
  const opened = await act(endpoint, "open", { ...session, action: "open", url: mainUrl });
  assert(
    opened.ok === true && opened.title === "AGX Action Executor Fixture" && typeof opened.tab_id === "number",
    `J4-a near_browser_open 打开指定页面并提取标题（title="${opened.title}"）`,
  );

  const extracted = await act(endpoint, "extract_text", { ...session, action: "extract_text" });
  assert(
    extracted.ok === true && typeof extracted.text === "string" && extracted.text.includes("welcome to the sp3 executor fixture"),
    "J4-b near_browser_extract_text 提取页面正文",
  );

  // 「帮我填表」：先 snapshot 拿索引，再 type+submit
  const snap = await act(endpoint, "snapshot", { ...session, action: "snapshot" });
  const elements = Array.isArray(snap.elements) ? snap.elements : [];
  const emailEl = elements.find((el) => el?.text === "Email" && el.tag === "input");
  const incEl = elements.find((el) => el?.text === "Increment" && el.tag === "button");
  assert(
    elements.length >= 6 && Boolean(emailEl && incEl),
    `J4-c near_browser_snapshot 索引页面控件（${elements.length} 个，含表单输入/按钮）`,
  );

  const typed = await act(endpoint, "type+submit", {
    ...session,
    action: "type",
    index: emailEl?.index,
    text: "agx@example.com",
    submit: true,
  });
  const formResult = await extractText(endpoint, session, "form-result");
  assert(
    typed.ok === true && formResult.includes("form-result: agx@example.com"),
    `J4-d near_browser_type 帮我填表并提交（${formResult.trim()}）`,
  );

  const clicked = await act(endpoint, "click", { ...session, action: "click", index: incEl?.index });
  const counter = await extractText(endpoint, session, "Counter");
  assert(
    clicked.ok === true && counter.includes("Counter: 1"),
    `J4-e near_browser_click 点击按钮生效（${counter.trim()}）`,
  );

  const pressed = await act(endpoint, "press_key", { ...session, action: "press_key", key: "j" });
  const lastKey = await extractText(endpoint, session, "last-key");
  assert(
    pressed.ok === true && lastKey.includes("last-key: j"),
    `J4-f near_browser_press_key 按键事件落地（${lastKey.trim()}）`,
  );

  // 「截图」
  const shot = await act(endpoint, "screenshot", { ...session, action: "screenshot" });
  const png = shot.image_base64 ? Buffer.from(shot.image_base64, "base64") : null;
  assert(
    shot.ok === true &&
      png !== null &&
      png.length > 8 &&
      png[0] === 0x89 && png[1] === 0x50 && png[2] === 0x4e && png[3] === 0x47,
    `J4-g near_browser_screenshot 返回可解码 PNG（${png?.length ?? 0} 字节，magic bytes 命中）`,
  );

  // 二次 open 同 URL 复用 tab（agent 连续指令不重复开页）
  const reopened = await act(endpoint, "open same url", { ...session, action: "open", url: mainUrl });
  assert(
    reopened.ok === true && reopened.tab_id === opened.tab_id,
    "J4-h 连续指令复用同一 tab（同 URL 不重复开页）",
  );
  await journeyEnd();
}

// ---------------------------------------------------------------------------
// J5 · 安全场景
// ---------------------------------------------------------------------------

async function journeyJ5(endpoint, fixtureBase, agxHome) {
  beginJourney("J5", "安全场景（银行站被拦 + 密码框确认卡片 + 审计留痕）");
  const session = { session_id: "uj-e2e-safety" };
  const safetyUrl = `${fixtureBase}/safety-page.html`;
  const bankUrl = `http://${DENIED_BANK_HOST}:${new URL(fixtureBase).port}/safety-page.html`;

  // agent 试图打开银行站 → 拦截先于任何导航/网络
  const bank = await act(endpoint, "open bank", { ...session, action: "open", url: bankUrl });
  assert(
    bank.ok === false && bank.error === "blocked: sensitive domain" && bank.blocked === true && bank.domain === DENIED_BANK_HOST,
    `J5-a 银行站被敏感域拦截（error="${bank.error}", domain=${bank.domain}）`,
  );

  const opened = await act(endpoint, "open safety fixture", { ...session, action: "open", url: safetyUrl });
  assert(opened.ok === true, "J5-b 打开普通测试页（未被误拦）");
  const snap = await act(endpoint, "snapshot", { ...session, action: "snapshot" });
  const elements = Array.isArray(snap.elements) ? snap.elements : [];
  const pwEl = elements.find((el) => el?.is_password === true);
  const cardDenyEl = elements.find((el) => el?.text === "Card deny" && el.tag === "button");
  const cardAllowEl = elements.find((el) => el?.text === "Card allow" && el.tag === "button");
  assert(
    Boolean(pwEl && cardDenyEl && cardAllowEl),
    "J5-c snapshot 索引到密码框与卡片操作钩子",
  );

  // 填密码框 → 确认卡片弹出 → 用户点「拒绝」→ 不执行
  const seenBefore = await cardSeenCount(endpoint, session);
  const denyPending = postAct(endpoint, { ...session, action: "type", index: pwEl?.index, text: "deny-me-123" });
  await waitForCardCount(endpoint, session, seenBefore + 1, "确认卡片弹出（拒绝路径）");
  const denyTyped = await act(endpoint, "click card deny", { ...session, action: "click", index: cardDenyEl?.index });
  const denyResult = await denyPending;
  const pwAfterDeny = await extractText(endpoint, session, "pw-typed");
  assert(
    denyTyped.ok === true && denyResult.ok === false && denyResult.error === "user_declined",
    `J5-d 填密码框弹出确认卡片，拒绝后不执行（error="${denyResult.error}"）`,
  );
  assert(
    pwAfterDeny.includes("pw-typed: (none)"),
    "J5-e 被拒绝的输入从未落到页面（pw-typed: (none)）",
  );

  // 填密码框 → 卡片 → 用户点「允许」→ 执行 + confirmed
  const allowPending = postAct(endpoint, { ...session, action: "type", index: pwEl?.index, text: "allow-me-456" });
  await waitForCardCount(endpoint, session, seenBefore + 2, "确认卡片弹出（允许路径）");
  await act(endpoint, "click card allow", { ...session, action: "click", index: cardAllowEl?.index });
  const allowResult = await allowPending;
  const pwAfterAllow = await extractText(endpoint, session, "pw-typed");
  assert(
    allowResult.ok === true && allowResult.confirmed === true && pwAfterAllow.includes("pw-typed: allow-me-456"),
    "J5-f 用户放行后输入执行且标记 confirmed:true",
  );

  // 审计留痕（SP4 判据 4 的采样断言）
  const outbox = path.join(agxHome, "action_audit", "outbox.jsonl");
  const lines = fs.existsSync(outbox)
    ? fs.readFileSync(outbox, "utf-8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l))
    : [];
  const bankBlockedLine = lines.find(
    (row) => row.outcome === "blocked" && String(row.tab_url).includes(DENIED_BANK_HOST),
  );
  const confirmedLine = lines.find((row) => row.outcome === "confirmed");
  assert(
    Boolean(bankBlockedLine),
    "J5-g 审计 outbox 记录银行站拦截行（outcome=blocked + 银行域 tab_url）",
  );
  assert(
    Boolean(confirmedLine) && confirmedLine.risk === "high",
    "J5-h 审计 outbox 记录高风险放行动作（outcome=confirmed, risk=high）",
  );
  await journeyEnd();
}

// ---------------------------------------------------------------------------
// J6 · 异常场景
// ---------------------------------------------------------------------------

/** Bridge restart options (set in main before any journey runs). */
let studioOptionsForRestart = undefined;

async function journeyJ6(bridge, agxHome, fixtureBase) {
  beginJourney("J6", "异常场景（desktop 未启动 → 扩展提示；断链 → 30s 内自愈）");
  const localPage = `${fixtureBase.replace("127.0.0.1", "localhost")}/page-inject.html`;

  // ---- 模拟 desktop 未启动：停掉 bridge（NM socket 随之关闭）----
  console.log("[verify] 停掉 bridge（模拟 desktop 未启动）…");
  bridge.stopNearBrowserBridge();
  await delay(200);
  await waitFor(
    async () => (await swStorageGet("nm"))?.status === "disconnected",
    20_000,
    "SW nm.status=disconnected（desktop 停止后）",
  );
  const nmDown = await swStorageGet("nm");
  assert(
    nmDown?.status === "disconnected",
    "J6-a desktop 停止后扩展侧状态变为 disconnected（popup 同步显示未连接）",
  );

  // 用户此时划词发送 → 扩展必须显式提示「AGX 未运行」，绝不静默
  await clickMenu("agx-inject-selection", localPage);
  const denied = await waitForInjectResult(
    (row) => row.ok === false && row.error === "nm_disconnected",
    "nm_disconnected 结果记录",
  );
  assert(
    Boolean(denied) && denied.notified === true,
    `J6-b desktop 未启动时划词 → 扩展显式提示（error=nm_disconnected, notified=${denied?.notified}）`,
  );

  // ---- desktop 回来了：bridge 重启 → SW 退避自愈重连 ----
  console.log("[verify] 重启 bridge（模拟 desktop 再次启动）…");
  const restartAt = Date.now();
  bridge.startNearBrowserBridge(() => null, studioOptionsForRestart);
  await waitForBridgeFiles(agxHome);
  const healed = await waitFor(async () => {
    const nm = await swStorageGet("nm");
    return nm && nm.status === "connected" && typeof nm.lastPongAt === "number" && nm.lastPongAt > restartAt
      ? nm
      : null;
  }, HEAL_BUDGET_MS, "desktop 重启后 SW 自愈重连（新 pong）");
  const healMs = healed ? healed.lastPongAt - restartAt : -1;
  assert(
    Boolean(healed) && healMs >= 0,
    `J6-c desktop 重启后扩展自动重连并记录新 pong（${healMs}ms，退避上限 30s 内）`,
  );

  const endpoint = await waitForBridgeFiles(agxHome);
  const status = await getStatus(endpoint);
  assert(
    status.extension_online === true,
    "J6-d 自愈后 desktop 侧 /v1/browser/status 重新在线",
  );

  // ---- 断链（NM shim 进程被杀，socket 仍在）→ 30s 内自愈 ----
  // sw.js 的 alarm 心跳每过一个周期就 reconnectAttempts=0（视为全新退避），
  // 这里先等价重置，使断链自愈在「新鲜退避」这一真实会出现的条件下测
  // （SP1 phase-2 同条件测得 ~1.1s），否则退避已增长到 30s 上限会贴线。
  await swEvaluate(`reconnectAttempts = 0`);
  const pids = findShimPids();
  const killAt = Date.now();
  if (pids.length > 0) {
    for (const pid of pids) process.kill(pid, "SIGKILL");
    console.log(`[verify] SIGKILL shim pids [${pids.join(", ")}] at ${killAt}`);
    const rePong = await waitFor(async () => {
      const nm = await swStorageGet("nm");
      return nm && typeof nm.lastPongAt === "number" && nm.lastPongAt > killAt ? nm : null;
    }, 30_000, "shim 被杀后的新 pong");
    const heal2Ms = rePong ? rePong.lastPongAt - killAt : -1;
    assert(
      Boolean(rePong) && heal2Ms >= 0 && heal2Ms <= 30_000,
      `J6-e 断链（shim 被杀）后 ${heal2Ms}ms 内自愈重连（预算 30s）`,
    );
  } else {
    assert(false, "J6-e 找不到 NM shim 进程（无法执行断链自愈检查）");
  }
  await journeyEnd();
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const browser = resolveBrowser();
  if (!browser || browser.kind !== "chrome_for_testing") {
    console.log(
      "BLOCKED: automation needs playwright's Chrome for Testing (SP1 finding #1: " +
        "branded Google Chrome ignores --load-extension); user-journey e2e skipped",
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

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-uj-e2e-"));
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
    fs.mkdirSync(agxHome, { recursive: true });
    // 审计门（对齐 Python audit_enabled()：enterprise.enabled + token）
    fs.writeFileSync(
      path.join(agxHome, "config.yaml"),
      [
        "version: '1'",
        "enterprise:",
        "  enabled: true",
        "  token: uj-e2e-audit-token",
        "  base_url: 'http://127.0.0.1:9'",
        "",
      ].join("\n"),
      "utf-8",
    );
    installNmHostIntoProfile(socketPath);

    process.env.AGX_HOME = agxHome;
    process.env.AGX_NM_SOCKET_PATH = socketPath;
    process.env.AGX_BROWSER_BACKEND = "extension";
    delete process.env.AGX_EXT_STUB;
    const bridge = loadBridgeWithMockElectron(workDir);
    studioOptionsForRestart = {
      injectContextStudio: { url: () => studio.base, token: () => STUDIO_TOKEN },
    };
    bridge.startNearBrowserBridge(() => null, studioOptionsForRestart);
    const endpoint = await waitForBridgeFiles(agxHome);

    console.log(`[verify] browser: ${browser.binary}`);
    chrome = spawn(
      browser.binary,
      [
        `--user-data-dir=${PROFILE_DIR}`,
        `--remote-debugging-port=${DEBUG_PORT}`,
        "--remote-allow-origins=*",
        `--load-extension=${extensionUnderTest}`,
        // SP4 finding #5-②：系统代理会绕过 host 解析规则/干扰本地 fixture
        "--no-proxy-server",
        "--no-first-run",
        "--no-default-browser-check",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe"], env: { ...process.env } },
    );
    // NM/shim 的日志全部走 Chrome stderr — 实时落盘便于现场诊断冷启动失败
    const stderrLive = fs.createWriteStream("/tmp/uj-chrome-stderr.log", { flags: "w" });
    chrome.stderr.on("data", (chunk) => {
      chromeStderr.push(chunk);
      stderrLive.write(chunk);
    });

    // SP5 boot gate：先等 bridge 侧看到 SW 心跳（零 CDP 流量），让 SW
    // 安静跑完冷启动（connectNative + alarms.create）。任何 DevTools
    // attach 抢跑都会打断这一窗口（SP1/本仓库实测）。
    await waitFor(
      async () => {
        try {
          const status = await getStatus(endpoint);
          return status.extension_online === true ? status : null;
        } catch {
          return null;
        }
      },
      SW_ONLINE_BUDGET_MS,
      "extension online (SW 心跳已被 bridge 看到)",
    );
    console.log("[verify] SW 已上线（bridge 侧 extension_online=true）");

    // J1 → J6：同一浏览器、同一 bridge、同一次用户旅程；单旅程异常只记
    // FAIL 断言并继续，绝不静默跳过。
    await runJourney("J1", journeyJ1, endpoint);
    await runJourney("J2", journeyJ2, fixture.base, studio);
    await runJourney("J3", journeyJ3, fixture.base, studio);
    await runJourney("J4", journeyJ4, endpoint, fixture.base);
    await runJourney("J5", journeyJ5, endpoint, fixture.base, agxHome);
    await runJourney("J6", journeyJ6, bridge, agxHome, fixture.base);
  } finally {
    if (chrome) {
      chrome.kill("SIGTERM");
      await delay(1000);
      if (chrome.exitCode === null) chrome.kill("SIGKILL");
    }
    swSession.close();
    for (const session of pageSessions.values()) session.close();
    pageSessions.clear();
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
      const text = Buffer.concat(chromeStderr).toString("utf-8");
      const native = text
        .split("\n")
        .filter((line) => /native_messag|load_extension/i.test(line))
        .slice(0, 10);
      if (native.length) console.log(`[verify] browser NM/extension log lines:\n${native.join("\n")}`);
    }
    console.log("[verify] cleaned up: browser killed, profile removed, bridge stopped");
  }

  // ---- 汇总表 ----
  const totalAssertions = journeys.reduce((sum, j) => sum + j.assertions, 0);
  const totalPass = journeys.reduce((sum, j) => sum + j.pass, 0);
  const totalFail = journeys.reduce((sum, j) => sum + j.fail, 0);
  const totalMs = journeys.reduce((sum, j) => sum + (j.elapsedMs ?? 0), 0);
  console.log(`\n${"=".repeat(76)}\n用户旅程 e2e 汇总\n${"=".repeat(76)}`);
  console.log("| 旅程 | 断言数 | PASS | FAIL | 耗时(ms) | NM RTT(ms) |");
  console.log("|---|---|---|---|---|---|");
  for (const j of journeys) {
    console.log(
      `| ${j.id} ${j.title.slice(0, 12)} | ${j.assertions} | ${j.pass} | ${j.fail} | ${j.elapsedMs ?? "-"} | ${j.rttMs ?? "-"} |`,
    );
  }
  console.log(`| 合计 | ${totalAssertions} | ${totalPass} | ${totalFail} | ${totalMs} | - |`);
  console.log(totalFail ? "\nRESULT: FAIL" : "\nRESULT: PASS");
  process.exit(totalFail ? 1 : 0);
}

main().catch((err) => {
  console.error(`RESULT: FAIL (${err.message})`);
  console.error(err);
  process.exit(1);
});
