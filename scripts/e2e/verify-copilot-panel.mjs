#!/usr/bin/env node
/**
 * SP7a e2e · Copilot 侧边栏面板 verification (real browser → real NM shim →
 * Node-side mock bridge), reusing the SP5 harness pattern:
 *
 *   panel.html opened as a normal tab (chrome-extension://…/panel.html)
 *     → 输入文字 → 点「发送」→ chrome.runtime.sendMessage {cmd:"agx_copilot_send"}
 *     → SW (copilot.js) assembles {type:"copilot_chat", request_id,
 *        session_id, text} → NM port → real nm-bridge-shim → unix socket
 *     → mock bridge (this file — the desktop stand-in, mirroring how the
 *       SP5 harness mocked Studio behind the real desktop bridge)
 *     → {type:"copilot_reply", ok:true, text:"mock_copilot_ack"}
 *     → SW broadcast agx_copilot_reply → panel renders the assistant bubble
 *
 * Assertions (SP7a plan §2.4 criteria):
 *   T0  real extension SW heartbeat reaches the mock bridge (ping → pong)
 *   P1  panel round-trip: session header from agx_active_session, user bubble,
 *       mock_copilot_ack assistant bubble, §1 NM payload shape, pending
 *       cleared, back to idle
 *   P2  busy state: input + send disabled while the reply is held; restored
 *       after release
 *   P3  mock bridge down → SW port down → nm_disconnected →「AGX 未运行」
 *       error state (red, not silent), 输入保留不丢, nothing reached the bridge
 *   P4  manifest posture: no standing host grant, sidePanel permission,
 *       side_panel.default_path === "panel.html"
 *   P5  existing 划词/整页 menu registration unaffected (inject.js probe)
 *
 * The mock bridge holds copilot_replies on demand so the busy state (P2) is
 * observed deterministically instead of racing the sub-100ms round trip.
 *
 * Exit code: 0 PASS / 1 FAIL / 2 BLOCKED (no automation-capable browser).
 *
 * Author: Damon Li
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { delay, waitFor, NM_HOST_NAME, SPIKE_EXTENSION_ID } from "./helpers.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EXTENSION_DIR = path.join(REPO_ROOT, "extension");
const SHIM_PATH = path.join(REPO_ROOT, "scripts", "nm-bridge-shim.mjs");
const GOOGLE_CHROME_BIN = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PROFILE_DIR = "/tmp/agx-sp7a-e2e-profile";
const DEBUG_PORT = 9228;
/** Standing automation grants (SP5 harness parity — the panel flow itself
 *  needs no host access; the repo manifest keeps the store posture). */
const AUTOMATION_HOST_GRANTS = ["http://127.0.0.1/*", "http://localhost/*"];
const PANEL_URL = `chrome-extension://${SPIKE_EXTENSION_ID}/panel.html`;
const MOCK_REPLY_TEXT = "mock_copilot_ack";
const SEED_SESSION = { session_id: "s-latest", name: "SP7a 面板会话", ts: Date.now() };

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
// harness (SP5 pattern)
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
  // SP1 finding #2: NM manifests are looked up inside the --user-data-dir profile.
  const manifestPath = path.join(PROFILE_DIR, "NativeMessagingHosts", `${NM_HOST_NAME}.json`);
  const manifest = {
    name: NM_HOST_NAME,
    description: "AgenticX browser extension bridge (SP7a e2e)",
    path: wrapperPath,
    type: "stdio",
    allowed_origins: [`chrome-extension://${SPIKE_EXTENSION_ID}/`],
  };
  fs.mkdirSync(path.dirname(manifestPath), { recursive: true });
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { encoding: "utf8" });
  console.log(`[verify] NM host installed: ${manifestPath}`);
}

/** Temp copy of extension/ with the automation host grants patched in (SP5
 *  harness parity; the repo manifest keeps optional_host_permissions). */
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
// mock bridge — the desktop stand-in at the shim's unix socket (the same
// role the mock Studio server plays in the SP5 harness; SP7b's real desktop
// dispatch is independently covered by desktop/tests/browser-bridge-copilot.test.ts).
// JSONL protocol identical to the desktop nm-socket-server: {type:"ping"} →
// pong; {type:"copilot_chat"} → {type:"copilot_reply", ok:true,
// text:"mock_copilot_ack"}. state.hold parks replies for the P2 busy probe.
// ---------------------------------------------------------------------------

function startMockBridge(socketPath) {
  const state = { pings: 0, chats: [], hold: false };
  const held = [];
  // net.Server has NO closeAllConnections (http.Server-only API) — track the
  // sockets so close() can destroy them; otherwise the shim's established
  // connection survives server.close() and the SW never sees a disconnect.
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
            text: MOCK_REPLY_TEXT,
          };
          if (state.hold) held.push({ socket, reply });
          else socket.write(`${JSON.stringify(reply)}\n`);
        }
        // anything else (act etc.) — not part of this scenario; ignore
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
          // Destroy first: the shim sees "socket closed by desktop" → exits →
          // Chrome tears the NM port down → the SW enters its disconnected
          // path (the P3 scenario under test).
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
// CDP helpers (node ≥22 WebSocket; SP4/SP5 pattern)
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
      // Hard fails so a target dying mid-evaluate (MV3 SW recycling) can never
      // leave this promise pending forever — the outer waitFors rely on it.
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

/** Evaluate inside the extension service worker (SP5 note: the NM port +
 *  ping alarm keep it warm; transient absence is retried). */
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

/** Evaluate inside the panel tab (P1 opens panel.html as a normal page). */
function panelEvaluate(expression) {
  return waitFor(async () => {
    try {
      const targets = await fetchJsonTargets();
      const page = targets.find((t) => t.type === "page" && t.url.startsWith(PANEL_URL));
      if (!page?.webSocketDebuggerUrl) return null;
      return await cdpEvaluate(page.webSocketDebuggerUrl, expression);
    } catch {
      return null;
    }
  }, 30_000, `panel evaluate: ${expression.slice(0, 60)}…`);
}

/** Open a tab from inside the SW and wait until it finished loading. */
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

/** Full panel DOM snapshot for the scenario assertions. */
function panelRead() {
  return panelEvaluate(`(() => ({
    session: document.getElementById("session-name").textContent,
    status: document.getElementById("status").textContent,
    statusClass: document.getElementById("status").className,
    inputDisabled: document.getElementById("input").disabled,
    sendDisabled: document.getElementById("send").disabled,
    inputValue: document.getElementById("input").value,
    user: [...document.querySelectorAll(".msg.user")].map((el) => el.textContent),
    assistant: [...document.querySelectorAll(".msg.assistant")].map((el) => el.textContent),
  }))()`);
}

/** Type into the panel input and click 发送 (the real panel code path). */
function panelSend(text) {
  return panelEvaluate(`(() => {
     const input = document.getElementById("input");
     input.value = ${JSON.stringify(text)};
     document.getElementById("send").click();
     return "sent";
   })()`);
}

// ---------------------------------------------------------------------------
// SP7a scenario
// ---------------------------------------------------------------------------

async function runScenario(mock) {
  // ---- P4: manifest posture (asserted on the repo manifest) ---------------
  const repoManifest = JSON.parse(fs.readFileSync(path.join(EXTENSION_DIR, "manifest.json"), "utf8"));
  assert(
    (!Array.isArray(repoManifest.host_permissions) || repoManifest.host_permissions.length === 0) &&
      JSON.stringify(repoManifest.optional_host_permissions).includes("<all_urls>"),
    "P4 repo manifest keeps the store posture (no standing host grant; optional_host_permissions only)",
  );
  assert(repoManifest.permissions.includes("sidePanel"), "P4 sidePanel permission present");
  assert(
    repoManifest.side_panel?.default_path === "panel.html",
    `P4 side_panel.default_path === "panel.html" (got ${JSON.stringify(repoManifest.side_panel)})`,
  );

  // ---- P5: 划词/整页 menu registration unaffected (SP7c adds the 3rd item) --
  // NB: this Chrome build's chrome.contextMenus has NO getAll — inject.js
  // keeps agxInjectMenuIds, populated only from real create() callbacks.
  const menus = await waitFor(async () => await swEvaluate(`agxInjectMenuIds`), 10_000, "P5 menu registration");
  assert(
    JSON.stringify(menus) === JSON.stringify(["agx-inject-selection", "agx-inject-page", "agx-copilot-selection"]),
    `P5 划词/整页 context-menu items still registered + the SP7c 划词问 AGX item (${JSON.stringify(menus)})`,
  );

  // ---- P1: panel round-trip with the mock bridge --------------------------
  await swEvaluate(
    `(async () => {
       await chrome.storage.local.set({ agx_active_session: ${JSON.stringify(SEED_SESSION)} });
       return "ok";
     })()`,
  );
  await openTabAndWait(PANEL_URL);
  const header = await waitFor(
    async () => {
      const text = await panelEvaluate(`document.getElementById("session-name").textContent`);
      return text === `会话：${SEED_SESSION.name}` ? text : null;
    },
    10_000,
    "P1 session header",
  );
  assert(Boolean(header), `P1 header shows the bound session from agx_active_session (${header})`);

  await panelSend("你好，AGX");
  const p1 = await waitFor(async () => {
    const st = await panelRead();
    return st.assistant.includes(MOCK_REPLY_TEXT) ? st : null;
  }, 20_000, "P1 assistant reply rendered");
  assert(p1.user.includes("你好，AGX"), `P1 user bubble rendered (${JSON.stringify(p1.user)})`);
  assert(
    p1.assistant.includes(MOCK_REPLY_TEXT),
    `P1 mock reply rendered as an assistant bubble (${JSON.stringify(p1.assistant)})`,
  );
  assert(
    !p1.inputDisabled && !p1.sendDisabled && p1.inputValue === "",
    "P1 back to idle after the reply (input re-enabled and cleared)",
  );
  const chat1 = mock.state.chats[0] ?? {};
  assert(
    chat1.type === "copilot_chat" &&
      chat1.text === "你好，AGX" &&
      typeof chat1.request_id === "string" &&
      chat1.request_id.length > 0,
    `P1 NM payload matches the §1 contract ({type:"copilot_chat", request_id, text}: ${JSON.stringify(chat1)})`,
  );
  assert(chat1.session_id === "s-latest", `P1 payload carries the cached session_id (s-latest)`);
  assert(
    !("source_url" in chat1) && !("kind" in chat1),
    "P1 manual panel input sends no source_url/kind (kind undefined ⇒ 手输)",
  );
  const p1pending = await swEvaluate(
    `(async () => (await chrome.storage.session.get("agx_copilot_pending")).agx_copilot_pending ?? null)()`,
  );
  assert(p1pending === null, "P1 SW pending request cleared after the reply");

  // ---- P2: busy state — reply held at the bridge ---------------------------
  mock.state.hold = true;
  await panelSend("第二句：busy 探测");
  const p2busy = await panelRead();
  assert(
    p2busy.inputDisabled === true && p2busy.sendDisabled === true,
    "P2 busy state disables both the input and the send button",
  );
  assert(p2busy.status.includes("正在回复"), `P2 busy hint shown (${p2busy.status})`);
  mock.releaseHeld();
  const p2done = await waitFor(async () => {
    const st = await panelRead();
    return !st.inputDisabled && st.assistant.length >= 2 ? st : null;
  }, 20_000, "P2 reply after release");
  assert(p2done.assistant.length === 2, `P2 held reply rendered after release (${p2done.assistant.length} bubbles)`);
  assert(!p2done.sendDisabled, "P2 send button re-enabled after the reply");
  const p2pending = await swEvaluate(
    `(async () => (await chrome.storage.session.get("agx_copilot_pending")).agx_copilot_pending ?? null)()`,
  );
  assert(p2pending === null, "P2 SW pending cleared again (busy → idle round-trip)");

  // ---- P3: mock bridge down → nm_disconnected error state -----------------
  console.log("[verify] closing the mock bridge (AGX 未运行 case) …");
  await mock.close();
  await waitFor(
    async () => (await swEvaluate(`port === null`)) === true,
    15_000,
    "SW NM port down after the bridge closed",
  );
  // Freeze the SW reconnect timer so the dying-shim respawn race cannot
  // swallow the P3 send into a half-open port (harness-only stabilization;
  // the assertion targets the panel error path, not the SW backoff).
  await swEvaluate(
    `(async () => { if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; } return "frozen"; })()`,
  );
  await panelSend("AGX 你在吗");
  const p3 = await waitFor(async () => {
    const st = await panelRead();
    return !st.inputDisabled && st.status.includes("AGX 未运行") ? st : null;
  }, 20_000, "P3 nm_disconnected error state");
  assert(
    p3.status.includes("AGX 未运行：无法连接 AGX 桌面端") && p3.statusClass.includes("error"),
    `P3 NM down → 「AGX 未运行」 error shown in red, not silent (${JSON.stringify(p3.status)})`,
  );
  assert(!p3.inputDisabled, "P3 error state returns to editable (idle), not stuck busy");
  assert(p3.inputValue === "AGX 你在吗", `P3 输入保留不丢 (input still holds "${p3.inputValue}")`);
  assert(mock.state.chats.length === 2, `P3 the failed send never reached the bridge (${mock.state.chats.length} rows)`);
  const p3pending = await swEvaluate(
    `(async () => (await chrome.storage.session.get("agx_copilot_pending")).agx_copilot_pending ?? null)()`,
  );
  assert(p3pending === null, "P3 no pending request left behind by the failed send");
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main() {
  const browser = resolveBrowser();
  if (!browser || browser.kind !== "chrome_for_testing") {
    console.log(
      "BLOCKED: automation needs playwright's Chrome for Testing (SP1 finding #1: " +
        "branded Google Chrome ignores --load-extension); SP7a copilot-panel check skipped",
    );
    process.exit(2);
  }
  if (fs.existsSync(PROFILE_DIR)) {
    fs.rmSync(PROFILE_DIR, { recursive: true, force: true });
  }
  if (await isDebugPortTaken()) {
    throw new Error(`port ${DEBUG_PORT} already serves a DevTools endpoint — stop it first`);
  }

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "agx-sp7a-e2e-"));
  const socketPath = path.join(workDir, "browser_bridge_nm.sock");
  const mock = await startMockBridge(socketPath);
  console.log(`[verify] mock bridge: ${socketPath}`);

  let chrome = null;
  const chromeStderr = [];
  try {
    const extensionUnderTest = patchExtensionForAutomation(workDir);
    installNmHostIntoProfile();

    // The NM host (shim) inherits Chrome's env: point it at the mock socket.
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

    await runScenario(mock);
  } finally {
    if (chrome) {
      chrome.kill("SIGTERM");
      await delay(1000);
      if (chrome.exitCode === null) chrome.kill("SIGKILL");
    }
    await mock.close();
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
