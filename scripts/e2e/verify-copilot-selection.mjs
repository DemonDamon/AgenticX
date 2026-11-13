#!/usr/bin/env node
/**
 * SP7c e2e · 划词联动侧边栏 verification (real browser → real NM shim → Node
 * mock bridge), reusing the SP5/SP7a harness patterns:
 *
 *   fixture page 选中文字 → 合成右键菜单「划词问 AGX」（SP5 mode：原生菜单
 *   不可自动化，真实 handler agxHandleContextMenuClick 在真实 SW 里跑）
 *     → 敏感域名 gate（SP4 verdict 函数）→ activeTab 采集（真实 executeScript）
 *     → SP7a SW 发送路径（copilot.js：copilot_chat + pending + 广播）
 *     → NM → shim → mock bridge（本文件，桌面端替身——真实桌面 dispatch 由
 *       SP7b desktop/tests/browser-bridge-copilot.test.ts 覆盖）
 *     → {type:"copilot_reply"} → SW 广播 → panel（以 tab 打开的 panel.html，
 *       与 sidePanel 打开的是同一渲染逻辑/同一份 storage）显示回答
 *
 * Assertions (SP7c plan §1.3 判据):
 *   S1  三菜单注册探针（agx-inject-selection / agx-inject-page /
 *       agx-copilot-selection，真实 create() 回调）
 *   S2  合成菜单点击 → copilot_chat 发出且带 kind:"selection"/source_url/
 *       source_title + 划词预填态（面板打开即显示 pending 摘要 + 来源标注条）
 *       + 回答就地渲染 + pending 清理
 *   S3  sidePanel.open 抛错（测试缝 agxSidePanelOpenFn）→ 消息照发 +
 *       notifications toast fallback（终态记录含 toast_message/notified，无静默）
 *   S4  markdown-lite：加粗/行内代码/代码块/链接渲染正确 + `<script>` 注入
 *       被 escape（.msg.assistant 内 0 个 script 元素，文本里保留字面量）
 *   S5  敏感域名页（www.icbc.com.cn）划词 → SP4 verdict 采集前拦截，
 *       不发送（mock bridge 0 新增）+ 显式拦截记录
 *   S6  manifest 姿势回归：无常驻 host grant、sidePanel 权限、
 *       side_panel.default_path、action 无 default_popup（SP7c：点图标开面板）
 *       + SW setPanelBehavior(openPanelOnActionClick) 已生效
 *
 * Exit code: 0 PASS / 1 FAIL / 2 BLOCKED (no automation-capable browser).
 *
 * Author: Damon Li
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { delay, waitFor, NM_HOST_NAME, SPIKE_EXTENSION_ID } from "./helpers.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXTENSION_DIR = path.join(REPO_ROOT, "extension");
const FIXTURES_DIR = path.join(REPO_ROOT, "scripts", "e2e", "fixtures");
const SHIM_PATH = path.join(REPO_ROOT, "scripts", "nm-bridge-shim.mjs");
const GOOGLE_CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE_DIR = "/tmp/agx-sp7c-e2e-profile";
const DEBUG_PORT = 9230;
/** Standing automation grants (SP5 harness parity). */
const AUTOMATION_HOST_GRANTS = ["http://127.0.0.1/*", "http://localhost/*"];
const PANEL_URL = `chrome-extension://${SPIKE_EXTENSION_ID}/panel.html`;
const MOCK_REPLY_TEXT = "mock_copilot_ack";
const SEED_SESSION = { session_id: "s-latest", name: "SP7c 划词会话", ts: Date.now() };
/** S5: deny-list bank host (pattern "icbc.com.cn" matches as parent domain). */
const DENIED_BANK_URL = "https://www.icbc.com.cn/index.html";
/** S4 markdown sample（含 <script> 注入探针）。 */
const MARKDOWN_REPLY = [
  "**加粗** 和 `行内代码` 和 [AGX 链接](https://example.com/agx)",
  "```",
  "code line 1",
  "<script>alert(1)</script>",
  "```",
  "尾部 <script>alert(2)</script>",
].join("\n");

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
// harness (SP5/SP7a pattern)
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
  const manifestPath = path.join(PROFILE_DIR, "NativeMessagingHosts", `${NM_HOST_NAME}.json`);
  const manifest = {
    name: NM_HOST_NAME,
    description: "AgenticX browser extension bridge (SP7c e2e)",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${SPIKE_EXTENSION_ID}/`],
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8" });
  console.log(`[verify] NM host installed: ${manifestPath}`);
}

/** Temp copy of extension/ with the automation host grants patched in. */
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
// fixture server（127.0.0.1，复用 SP5 的 page-inject.html）
// ---------------------------------------------------------------------------

function startFixtureServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url || "/", "http://127.0.0.1").pathname);
    const filePath =
      urlPath === "/" || urlPath === ""
        ? path.join(FIXTURES_DIR, "page-inject.html")
        : path.join(FIXTURES_DIR, urlPath);
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
      resolve({ server, base: `http://127.0.0.1:${server.address().port}/page-inject.html` });
    });
  });
}

// ---------------------------------------------------------------------------
// mock bridge — the desktop stand-in. state.replyText 可配（S4 markdown 探针）；
// state.hold 支撑 S2 的预填态观测。JSONL 协议与 SP7a 相同。
// ---------------------------------------------------------------------------

function startMockBridge(socketPath) {
  const state = { pings: 0, chats: [], hold: false, replyText: MOCK_REPLY_TEXT };
  const held = [];
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    let buffer = "";
    socket.setEncoding("utf8");
    socket.on("data", (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf("\n");
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line) continue;
        let row = null;
        try {
          row = JSON.parse(line);
        } catch {
          continue;
        }
        if (row?.type === "ping") {
          state.pings += 1;
          socket.write(`${JSON.stringify({ type: "pong", ts: row.ts })}\n`);
        } else if (row?.type === "copilot_chat") {
          state.chats.push(row);
          const reply = {
            type: "copilot_reply",
            request_id: row.request_id,
            session_id: row.session_id ?? "mock-session",
            ok: true,
            text: state.replyText,
          };
          if (state.hold) held.push({ socket, reply });
          else socket.write(`${JSON.stringify(reply)}\n`);
        }
      }
    });
    socket.on("error", () => socket.destroy());
  });
  return new Promise((resolve, reject) => {
    server.on("error", reject);
    try {
      fs.unlinkSync(socketPath);
    } catch {
      /* absent is fine */
    }
    server.listen(socketPath, () => {
      let closed = false;
      resolve({
        socketPath,
        state,
        releaseHeld: () => {
          state.hold = false;
          for (const { socket, reply } of held.splice(0)) {
            if (!socket.destroyed) socket.write(`${JSON.stringify(reply)}\n`);
          }
        },
        close: () => {
          if (closed) return;
          closed = true;
          for (const socket of sockets) socket.destroy();
          return new Promise((closeResolve) => {
            server.close(() => {
              try {
                fs.unlinkSync(socketPath);
              } catch {
                /* already gone */
              }
              closeResolve();
            });
          });
        },
      });
    });
  });
}

// ---------------------------------------------------------------------------
// CDP helpers (node ≥22 WebSocket; SP4/SP5/SP7a pattern)
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
      const timer = setTimeout(() => reject(new Error("CDP evaluate timeout (target died?)")), 15_000);
      ws.onclose = () => {
        clearTimeout(timer);
        reject(new Error("CDP socket closed before a response (target died?)"));
      };
      ws.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.id !== 1) return;
        clearTimeout(timer);
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

function pageEvaluate(urlPrefix, expression) {
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

function panelEvaluate(expression) {
  return pageEvaluate(PANEL_URL, expression);
}

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

/** SP5 mode: synthetic context-menu click — the REAL handler on the REAL tab.
 *  tabOverride (S5) patches the tab's url to a deny-listed host (gate reads
 *  tab.url before anything is collected). */
function clickMenu(menuItemId, tabUrl, tabOverride) {
  return swEvaluate(
    `(async () => {
       const tabs = await chrome.tabs.query({ url: ${JSON.stringify(tabUrl)} });
       if (!tabs.length) return "NO_TAB";
       await agxHandleContextMenuClick({ menuItemId: ${JSON.stringify(menuItemId)} }, ${
         tabOverride ? `Object.assign({}, tabs[0], ${JSON.stringify(tabOverride)})` : "tabs[0]"
       });
       return "clicked";
     })()`,
  );
}

/** The SP7c terminal record (anti-silent-failure contract). */
async function readCopilotSelectionResult() {
  const value = await swEvaluate(
    `(async () => (await chrome.storage.local.get("agx_copilot_selection_last_result")).agx_copilot_selection_last_result ?? null)()`,
  );
  return value ?? null;
}

function waitForCopilotResult(predicate, label) {
  return waitFor(async () => {
    const row = await readCopilotSelectionResult();
    return row && predicate(row) ? row : null;
  }, 20_000, label);
}

/** Panel DOM snapshot for the scenario assertions. */
function panelSnapshot() {
  return panelEvaluate(`(() => ({
    status: document.getElementById("status").textContent,
    statusClass: document.getElementById("status").className,
    inputDisabled: document.getElementById("input").disabled,
    sendDisabled: document.getElementById("send").disabled,
    user: [...document.querySelectorAll(".msg.user")].map((el) => el.textContent),
    sourceBars: [...document.querySelectorAll(".source-bar a")].map((a) => ({ href: a.href, text: a.textContent })),
    assistantText: [...document.querySelectorAll(".msg.assistant")].map((el) => el.textContent),
    assistantHtml: [...document.querySelectorAll(".msg.assistant")].map((el) => el.innerHTML),
    scriptLeak: document.querySelectorAll(".msg script, .source-bar script").length,
    strongCount: document.querySelectorAll(".msg.assistant strong").length,
    inlineCode: [...document.querySelectorAll(".msg.assistant > code")].map((el) => el.textContent),
    preCount: document.querySelectorAll(".msg.assistant pre").length,
    preText: [...document.querySelectorAll(".msg.assistant pre")].map((el) => el.textContent),
    links: [...document.querySelectorAll(".msg.assistant a")].map((a) => a.href),
  }))()`);
}

// ---------------------------------------------------------------------------
// SP7c scenario
// ---------------------------------------------------------------------------

async function runScenario(fixture, mock) {
  const chats = () => mock.state.chats;
  const fixtureUrl = fixture.base;

  // ---- S6: manifest 姿势回归（T7/P4 家族，repo manifest 上断言）--------------
  const repoManifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf8"));
  assert(
    (!Array.isArray(repoManifest.host_permissions) || repoManifest.host_permissions.length === 0) &&
      JSON.stringify(repoManifest.optional_host_permissions).includes("<all_urls>"),
    "S6 repo manifest keeps the store posture (no standing host grant; optional_host_permissions only)",
  );
  assert(repoManifest.permissions.includes("sidePanel"), "S6 sidePanel permission present");
  assert(
    repoManifest.side_panel?.default_path === "panel.html",
    `S6 side_panel.default_path === "panel.html" (got ${JSON.stringify(repoManifest.side_panel)})`,
  );
  assert(
    !("default_popup" in (repoManifest.action ?? {})),
    "S6 action pins NO default_popup — 工具栏图标交给 setPanelBehavior(openPanelOnActionClick)",
  );

  // ---- S1: 三菜单注册探针 ----------------------------------------------------
  const menus = await waitFor(async () => await swEvaluate(`agxInjectMenuIds`), 10_000, "S1 menu registration");
  assert(
    JSON.stringify(menus) === JSON.stringify(["agx-inject-selection", "agx-inject-page", "agx-copilot-selection"]),
    `S1 three context-menu items registered via real create() callbacks (${JSON.stringify(menus)})`,
  );

  // ---- S6b: 工具栏图标接线（SW 侧 setPanelBehavior 已生效）--------------------
  const behavior = await swEvaluate(`chrome.sidePanel.getPanelBehavior()`);
  assert(
    behavior?.openPanelOnActionClick === true,
    `S6 SW chrome.sidePanel.getPanelBehavior() → openPanelOnActionClick=true (${JSON.stringify(behavior)})`,
  );

  // ---- S2: 合成菜单点击 → copilot_chat（kind/source）+ 预填态 + 回答 ----------
  await swEvaluate(
    `(async () => {
       await chrome.storage.local.set({ agx_active_session: ${JSON.stringify(SEED_SESSION)} });
       return "ok";
     })()`,
  );
  await openTabAndWait(fixtureUrl);
  await makeSelection("http://127.0.0.1");
  // determinism: force the open-ok branch（真实 open() 在无手势自动化里会拒绝）
  await swEvaluate(`agxSidePanelOpenFn = async () => "opened"`);
  mock.state.hold = true; // 让面板有观测预填态的窗口
  const s2click = await clickMenu("agx-copilot-selection", fixtureUrl);
  assert(s2click === "clicked", `S2 synthetic 划词问 AGX menu click ran the real handler (${s2click})`);

  // NM round trip is async — wait for the chat row to land at the mock.
  const s2chat = await waitFor(
    () => (chats().length >= 1 ? chats()[0] : null),
    20_000,
    "S2 copilot_chat reaches the mock bridge",
  );
  assert(
    s2chat.type === "copilot_chat" &&
      s2chat.kind === "selection" &&
      s2chat.text === "page-inject-selected-text: hello from the agx fixture page" &&
      s2chat.source_url === fixtureUrl &&
      s2chat.source_title === "AGX Page Inject Fixture" &&
      typeof s2chat.request_id === "string" &&
      s2chat.request_id.length > 0,
    `S2 NM payload carries kind:"selection" + source_url/source_title (got ${JSON.stringify(s2chat)})`,
  );
  assert(s2chat.session_id === "s-latest", "S2 payload carries the cached session_id (s-latest)");
  const s2record = await waitForCopilotResult((row) => row.ok === true && row.opened === true, "S2 result ok+opened");
  assert(Boolean(s2record), `S2 terminal record ok:true/opened:true (${JSON.stringify(s2record)})`);

  const s2pending = await swEvaluate(
    `(async () => (await chrome.storage.session.get("agx_copilot_pending")).agx_copilot_pending ?? null)()`,
  );
  assert(
    s2pending?.request_id === s2chat.request_id &&
      s2pending?.kind === "selection" &&
      s2pending?.text_preview === "page-inject-selected-text: hello from the agx fixture page" &&
      s2pending?.source_url === fixtureUrl,
    `S2 SW pending record holds the panel-facing 划词预填 (${JSON.stringify(s2pending)})`,
  );
  // 划词预填摘要截断（首行 + 200 字符）——直接探针 copilot.js 的纯函数
  const previewMultiLine = await swEvaluate(`agxCopilotPreview("第一行\\n第二行")`);
  const previewTruncated = await swEvaluate(`agxCopilotPreview("首行" + "x".repeat(300))`);
  assert(
    previewMultiLine === "第一行" && previewTruncated === "首行" + "x".repeat(198) + "…",
    `S2 划词预填摘要 = 首行 + 200 字符截断 (multiline=${previewMultiLine}, truncated=${previewTruncated?.length} chars)`,
  );

  // 面板（以 tab 打开，与 sidePanel 同一渲染逻辑）打开即显示预填 + busy
  await openTabAndWait(PANEL_URL);
  const s2prefill = await panelSnapshot();
  assert(
    s2prefill.user.length === 1 &&
      s2prefill.user[0].includes("page-inject-selected-text: hello from the agx fixture page"),
    `S2 面板打开即显示 pending 划词预填（首行摘要气泡，${JSON.stringify(s2prefill.user)}）`,
  );
  assert(
    s2prefill.sourceBars.length === 1 &&
      s2prefill.sourceBars[0].href === fixtureUrl &&
      s2prefill.sourceBars[0].text.includes("AGX Page Inject Fixture"),
    `S2 来源标注条渲染且链接可点 (${JSON.stringify(s2prefill.sourceBars)})`,
  );
  assert(
    s2prefill.inputDisabled === true && s2prefill.sendDisabled === true && s2prefill.status.includes("正在回复"),
    "S2 预填态 = busy（输入与发送禁用 + 正在回复提示）",
  );

  mock.releaseHeld();
  const s2done = await waitFor(async () => {
    const st = await panelSnapshot();
    return !st.inputDisabled && st.assistantText.includes(MOCK_REPLY_TEXT) ? st : null;
  }, 20_000, "S2 reply rendered in-panel");
  assert(
    s2done.assistantText.includes(MOCK_REPLY_TEXT),
    `S2 回答就地显示（assistant 气泡 ${JSON.stringify(s2done.assistantText)}）`,
  );
  assert(!s2done.sendDisabled, "S2 回复后面板回到 idle（发送按钮恢复）");
  const s2pendingAfter = await swEvaluate(
    `(async () => (await chrome.storage.session.get("agx_copilot_pending")).agx_copilot_pending ?? null)()`,
  );
  assert(s2pendingAfter === null, "S2 SW pending cleared after the reply");

  // ---- S3: sidePanel.open 抛错 → fallback toast（无静默）----------------------
  await swEvaluate(`agxSidePanelOpenFn = async () => { throw new Error("synthetic: no user gesture") }`);
  const chatsBeforeS3 = chats().length;
  const s3click = await clickMenu("agx-copilot-selection", fixtureUrl);
  assert(s3click === "clicked", `S3 open-throw branch click ran (${s3click})`);
  const s3record = await waitForCopilotResult(
    (row) => row.ok === true && row.opened === false,
    "S3 open-failure record",
  );
  assert(
    Boolean(s3record) && s3record.notified === true && s3record.toast_message === "已发送，点工具栏图标查看回答",
    `S3 open 失败 ⇒ toast fallback「已发送，点工具栏图标查看回答」记录在案，绝不静默 (${JSON.stringify(s3record)})`,
  );
  assert(
    chats().length === chatsBeforeS3 + 1,
    `S3 消息照发（bridge 收到 ${chats().length} 条，基线 ${chatsBeforeS3}）`,
  );
  // 恢复 seam，后续场景不再走 toast 支路
  await swEvaluate(`agxSidePanelOpenFn = async () => "opened"`);

  // ---- S4: markdown-lite 渲染 + <script> escape 安全断言 ----------------------
  mock.state.replyText = MARKDOWN_REPLY;
  mock.state.hold = true;
  const s4click = await clickMenu("agx-copilot-selection", fixtureUrl);
  assert(s4click === "clicked", `S4 markdown 回复点击发出 (${s4click})`);
  // 面板已打开 → SP7c agx_copilot_pending 广播路径（已开面板的预填态；
  // S2/S3 各留下 1 条划词气泡，本条为第 3 条）
  const s4prefill = await waitFor(async () => {
    const st = await panelSnapshot();
    return st.inputDisabled === true && st.user.length === 3 ? st : null;
  }, 20_000, "S4 already-open panel enters busy via the pending broadcast");
  assert(
    s4prefill.user.length === 3 && s4prefill.sourceBars.length === 3,
    `S4 已打开的面板经 agx_copilot_pending 广播进入预填态（第 3 条划词气泡 + 来源条）`,
  );
  mock.releaseHeld();
  const s4done = await waitFor(async () => {
    const st = await panelSnapshot();
    return !st.inputDisabled && st.assistantText.length >= 3 ? st : null;
  }, 20_000, "S4 markdown reply rendered");
  const s4html = s4done.assistantHtml[s4done.assistantHtml.length - 1] ?? "";
  assert(
    s4done.strongCount >= 1 && s4html.includes("<strong>加粗</strong>"),
    `S4 加粗渲染（<strong>加粗</strong>）`,
  );
  assert(
    s4done.inlineCode.includes("行内代码"),
    `S4 行内代码渲染（${JSON.stringify(s4done.inlineCode)}）`,
  );
  assert(
    s4done.preCount === 1 && s4done.preText[0]?.includes("code line 1"),
    `S4 代码块渲染（<pre> 含 code line 1）`,
  );
  const parsedLinks = s4done.links.map((link) => {
    try {
      return new URL(String(link));
    } catch {
      return null;
    }
  });
  assert(
    parsedLinks.some((u) => u?.hostname === "example.com" && u?.pathname === "/agx"),
    `S4 链接渲染且可点（href 解析为 example.com/agx）`,
  );
  assert(
    s4done.scriptLeak === 0 && !s4html.includes("<script>"),
    `S4 <script> 注入被 escape：.msg/.source-bar 内 0 个 script 元素（html=${s4html.slice(0, 80)}…）`,
  );
  assert(
    s4done.assistantText[s4done.assistantText.length - 1].includes("<script>alert(1)</script>"),
    "S4 注入文本以字面量保留（escape 可见）",
  );
  mock.state.replyText = MOCK_REPLY_TEXT;

  // ---- S5: 敏感域名页划词 → 采集前拦截，不发送 --------------------------------
  const chatsBeforeS5 = chats().length;
  const s5click = await clickMenu("agx-copilot-selection", fixtureUrl, { url: DENIED_BANK_URL });
  assert(s5click === "clicked", `S5 银行页划词点击（gate 前置）ran (${s5click})`);
  const s5record = await waitForCopilotResult(
    (row) => row.ok === false && row.error === "sensitive_domain",
    "S5 sensitive_domain record",
  );
  assert(
    Boolean(s5record) &&
      s5record.domain === "www.icbc.com.cn" &&
      s5record.category === "banking" &&
      s5record.notified === true,
    `S5 敏感域名拦截显式落地（domain/category + toast attempt，${JSON.stringify(s5record)}）`,
  );
  assert(
    chats().length === chatsBeforeS5,
    `S5 拦截后不发送（bridge 仍 ${chats().length} 条，基线 ${chatsBeforeS5}）`,
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
        "branded Google Chrome ignores --load-extension); SP7c copilot-selection check skipped",
    );
    process.exit(2);
  }
  if (fs.existsSync(PROFILE_DIR)) {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  }
  if (await isDebugPortTaken()) {
    throw new Error(`port ${DEBUG_PORT} already serves a DevTools endpoint — stop it first`);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-sp7c-e2e-"));
  const socketPath = path.join(workDir, "browser_bridge_nm.sock");
  const mock = await startMockBridge(socketPath);
  const fixture = await startFixtureServer();
  console.log(`[verify] mock bridge: ${socketPath}`);
  console.log(`[verify] fixture server: ${fixture.base}`);

  let chrome = null;
  const chromeStderr = [];
  try {
    const extensionUnderTest = patchExtensionForAutomation(workDir);
    installNmHostIntoProfile();
    process.env.AGX_NM_SOCKET_PATH = socketPath;

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
      () => (mock.state.pings > 0 ? true : null),
      30_000,
      "extension SW heartbeat reaches the mock bridge (NM ping seen)",
    );
    assert(true, "T0 real extension SW heartbeat reaches the mock bridge");

    await runScenario(fixture, mock);
  } finally {
    if (chrome) {
      chrome.kill("SIGTERM");
      await delay(1000);
      if (chrome.exitCode === null) chrome.kill("SIGKILL");
    }
    await mock.close();
    fixture.server.close();
    fixture.server.closeAllConnections?.();
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
    console.log("[verify] cleaned up: browser killed, profile removed, mock bridge closed");
  }

  console.log(failures ? `\nRESULT: FAIL (${failures})` : "\nRESULT: PASS");
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(`RESULT: FAIL (${err.message})`);
  process.exit(1);
});
