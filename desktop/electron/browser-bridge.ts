import { ipcMain, webContents, type WebContents } from "electron";
import http from "node:http";
import net from "node:net";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

const CONFIG_DIR = path.join(os.homedir(), ".agenticx");
const PORT_FILE = path.join(CONFIG_DIR, "browser_bridge.port");
const TOKEN_FILE = path.join(CONFIG_DIR, "browser_bridge.token");
const DESKTOP_USE_DIR = path.join(CONFIG_DIR, "desktop-use");

const ACTIONS = new Set([
  "open",
  "snapshot",
  "click",
  "type",
  "press_key",
  "extract_text",
  "screenshot",
]);

type Pending = {
  resolve: (value: Record<string, unknown>) => void;
  timer: ReturnType<typeof setTimeout>;
};

let server: http.Server | null = null;
let token = "";
const pending = new Map<string, Pending>();

function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const address = srv.address() as net.AddressInfo | null;
      const port = address?.port;
      srv.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        if (!port) {
          reject(new Error("no free port"));
          return;
        }
        resolve(port);
      });
    });
    srv.on("error", reject);
  });
}

function isLoopback(addr: string | undefined): boolean {
  const raw = String(addr || "").trim().toLowerCase();
  return raw === "127.0.0.1" || raw === "::1" || raw === ":ffff:127.0.0.1";
}

function writeSecretFile(filePath: string, contents: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, contents, { encoding: "utf8", mode: 0o600 });
  try {
    fs.chmodSync(filePath, 0o600);
  } catch {
    /* windows */
  }
}

function removeBridgeFiles(): void {
  for (const filePath of [PORT_FILE, TOKEN_FILE]) {
    try {
      fs.unlinkSync(filePath);
    } catch {
      /* missing is fine */
    }
  }
}

function sendJson(
  res: http.ServerResponse,
  status: number,
  body: Record<string, unknown>,
): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readJsonBody(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          reject(new Error("body must be a JSON object"));
          return;
        }
        resolve(parsed as Record<string, unknown>);
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function timeoutMsFor(action: string): number {
  return action === "screenshot" || action === "open" ? 30_000 : 20_000;
}

function settle(requestId: string, value: Record<string, unknown>): void {
  const item = pending.get(requestId);
  if (!item) return;
  clearTimeout(item.timer);
  pending.delete(requestId);
  item.resolve(value);
}

export function startNearBrowserBridge(getHost: () => WebContents | null): void {
  if (server) return;

  ipcMain.handle("near-browser-act-result", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "invalid_result" };
    }
    const row = payload as Record<string, unknown>;
    const requestId = String(row.request_id || "").trim();
    if (!requestId) return { ok: false, error: "missing_request_id" };
    settle(requestId, row);
    return { ok: true };
  });

  ipcMain.handle("extract-near-browser-frames", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "invalid payload" };
    }
    const row = payload as { webContentsId?: unknown; query?: unknown };
    const id = Number(row.webContentsId);
    if (!Number.isInteger(id) || id <= 0) {
      return { ok: false, error: "missing_web_contents_id" };
    }
    const wc = webContents.fromId(id);
    if (!wc || wc.isDestroyed()) {
      return { ok: false, error: "guest_not_ready" };
    }
    const query = String(row.query || "").trim().toLowerCase();
    const frameScript = `(() => {
      const collect = (root) => {
        if (!root) return "";
        const chunks = [];
        const direct = root.innerText || root.textContent || "";
        if (direct) chunks.push(direct);
        const nodes = root.querySelectorAll ? root.querySelectorAll("*") : [];
        for (const el of nodes) {
          if (el.shadowRoot) chunks.push(collect(el.shadowRoot));
        }
        return chunks.join("\\n");
      };
      const raw = collect(document.body || document.documentElement);
      return String(raw || "").split(/\\n+/).map((line) => line.replace(/[ \\t]+/g, " ").trim()).filter(Boolean).join("\\n");
    })()`;
    const parts: string[] = [];
    const frames = wc.mainFrame?.framesInSubtree ?? [wc.mainFrame];
    for (const frame of frames) {
      if (!frame) continue;
      try {
        const raw = await frame.executeJavaScript(frameScript, false);
        const text = String(raw || "").trim();
        if (text) parts.push(text);
      } catch {
        /* frame not ready / destroyed */
      }
    }
    let text = parts.join("\n");
    if (query) {
      const hits = text
        .split(/\n+/)
        .map((line) => line.trim())
        .filter((line) => line.toLowerCase().includes(query))
        .slice(0, 80);
      if (hits.length) text = hits.join("\n");
    }
    return { ok: true, text: text.slice(0, 24000), frame_count: parts.length };
  });

  ipcMain.handle("save-near-browser-screenshot", async (_event, payload: unknown) => {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return { ok: false, error: "invalid payload" };
    }
    const dataUrl = String((payload as { dataUrl?: unknown }).dataUrl || "").trim();
    const matched = dataUrl.match(/^data:image\/png;base64,([A-Za-z0-9+/=]+)$/);
    if (!matched?.[1]) return { ok: false, error: "invalid_png" };
    try {
      fs.mkdirSync(DESKTOP_USE_DIR, { recursive: true });
      const filePath = path.join(DESKTOP_USE_DIR, `browser_${Date.now()}.png`);
      fs.writeFileSync(filePath, Buffer.from(matched[1], "base64"));
      return { ok: true, path: filePath };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  const requestListener = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    if (!isLoopback(req.socket.remoteAddress)) {
      sendJson(res, 403, { ok: false, error: "loopback_only" });
      return;
    }
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.method !== "POST" || url.pathname !== "/v1/browser/act") {
      sendJson(res, 404, { ok: false, error: "not_found" });
      return;
    }
    const auth = String(req.headers.authorization || "");
    if (auth !== `Bearer ${token}`) {
      sendJson(res, 401, { ok: false, error: "unauthorized" });
      return;
    }

    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      sendJson(res, 400, { ok: false, error: "invalid_json" });
      return;
    }

    const action = String(body.action || "").trim();
    const sessionId = String(body.session_id || "").trim();
    if (!ACTIONS.has(action) || !sessionId) {
      sendJson(res, 400, { ok: false, error: "invalid_action_or_session" });
      return;
    }

    const host = getHost();
    if (!host || host.isDestroyed()) {
      sendJson(res, 200, { ok: false, error: "desktop_window_unavailable" });
      return;
    }

    const requestId = crypto.randomUUID();
    const message = {
      request_id: requestId,
      session_id: sessionId,
      action,
      url: body.url,
      index: body.index,
      text: body.text,
      key: body.key,
      submit: body.submit,
      query: body.query,
    };

    const result = await new Promise<Record<string, unknown>>((resolve) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        resolve({
          ok: false,
          request_id: requestId,
          error: "timeout",
          hint: "WorkPanel 浏览器未在时限内回报，请确认右侧浏览器 tab 已打开。",
        });
      }, timeoutMsFor(action));
      pending.set(requestId, { resolve, timer });
      try {
        host.send("near-browser-act", message);
      } catch (err) {
        clearTimeout(timer);
        pending.delete(requestId);
        resolve({
          ok: false,
          request_id: requestId,
          error: "ipc_send_failed",
          hint: err instanceof Error ? err.message : String(err),
        });
      }
    });
    sendJson(res, 200, result);
  };

  void (async () => {
    try {
      const port = await findFreePort();
      token = crypto.randomUUID();
      const created = http.createServer((req, res) => {
        void requestListener(req, res);
      });
      created.listen(port, "127.0.0.1", () => {
        writeSecretFile(PORT_FILE, String(port));
        writeSecretFile(TOKEN_FILE, token);
        server = created;
      });
      created.on("error", (err) => {
        console.error("[near-browser-bridge]", err);
      });
    } catch (err) {
      console.error("[near-browser-bridge] start failed", err);
    }
  })();
}

export function stopNearBrowserBridge(): void {
  for (const [requestId, item] of pending) {
    clearTimeout(item.timer);
    item.resolve({ ok: false, request_id: requestId, error: "bridge_stopped" });
  }
  pending.clear();
  try {
    ipcMain.removeHandler("near-browser-act-result");
  } catch {
    /* already gone */
  }
  try {
    ipcMain.removeHandler("extract-near-browser-frames");
  } catch {
    /* already gone */
  }
  try {
    ipcMain.removeHandler("save-near-browser-screenshot");
  } catch {
    /* already gone */
  }
  if (server) {
    try {
      server.close();
    } catch {
      /* noop */
    }
    server = null;
  }
  token = "";
  removeBridgeFiles();
}
