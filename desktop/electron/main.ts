import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  nativeImage,
  shell,
  Tray
} from "electron";
import { spawn, ChildProcess, execFile } from "node:child_process";
import path from "node:path";
import net from "node:net";
import os from "node:os";
import fs from "node:fs";
import crypto from "node:crypto";
import yaml from "js-yaml";

type ProviderConfig = {
  api_key?: string;
  base_url?: string;
  model?: string;
  models?: string[];
};

type AgxConfig = {
  version?: string;
  default_provider?: string;
  providers?: Record<string, ProviderConfig>;
  user_mode?: "pro" | "lite";
  onboarding_completed?: boolean;
  confirm_strategy?: "manual" | "semi-auto" | "auto";
  active_provider?: string;
  active_model?: string;
  notifications?: {
    email?: {
      enabled?: boolean;
      smtp_host?: string;
      smtp_port?: number;
      smtp_username?: string;
      smtp_password?: string;
      smtp_use_tls?: boolean;
      from_email?: string;
      default_to_email?: string;
    };
  };
};

type EmailConfig = {
  enabled: boolean;
  smtp_host: string;
  smtp_port: number;
  smtp_username: string;
  smtp_password: string;
  smtp_use_tls: boolean;
  from_email: string;
  default_to_email: string;
};

const CONFIG_DIR = path.join(os.homedir(), ".agenticx");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.yaml");
const EMAIL_CONFIG_KEYS = new Set([
  "enabled",
  "smtp_host",
  "smtp_port",
  "smtp_username",
  "smtp_password",
  "smtp_use_tls",
  "from_email",
  "default_to_email",
]);
const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  enabled: true,
  smtp_host: "",
  smtp_port: 587,
  smtp_username: "",
  smtp_password: "",
  smtp_use_tls: true,
  from_email: "",
  default_to_email: "bingzhenli@hotmail.com",
};

const KNOWN_BASE_URLS: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com/v1",
  volcengine: "https://ark.cn-beijing.volces.com/api/v3",
  zhipu: "https://open.bigmodel.cn/api/paas/v4",
  bailian: "https://dashscope.aliyuncs.com/compatible-mode/v1",
  qianfan: "https://aip.baidubce.com/rpc/2.0/ai_custom/v1",
  minimax: "https://api.minimax.chat/v1",
  kimi: "https://api.moonshot.cn/v1",
};

const PROVIDER_FALLBACK_MODELS: Record<string, string[]> = {
  minimax: ["MiniMax-M2.5"],
};

function loadAgxConfig(): AgxConfig {
  if (!fs.existsSync(CONFIG_PATH)) return { version: "1", providers: {} };
  try {
    const raw = yaml.load(fs.readFileSync(CONFIG_PATH, "utf-8")) as AgxConfig;
    return raw ?? { version: "1", providers: {} };
  } catch {
    return { version: "1", providers: {} };
  }
}

function saveAgxConfig(cfg: AgxConfig): void {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, yaml.dump(cfg, { lineWidth: -1 }), "utf-8");
}

function normalizeEmailConfig(input: unknown): EmailConfig {
  if (!input || typeof input !== "object") return { ...DEFAULT_EMAIL_CONFIG };
  const row = input as Partial<EmailConfig>;
  return {
    enabled: Boolean(row.enabled ?? true),
    smtp_host: String(row.smtp_host ?? "").trim(),
    smtp_port: Number(row.smtp_port ?? 587) || 587,
    smtp_username: String(row.smtp_username ?? "").trim(),
    smtp_password: String(row.smtp_password ?? ""),
    smtp_use_tls: Boolean(row.smtp_use_tls ?? true),
    from_email: String(row.from_email ?? "").trim(),
    default_to_email: String(row.default_to_email ?? "bingzhenli@hotmail.com").trim() || "bingzhenli@hotmail.com",
  };
}

function parseBooleanStrict(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(lowered)) return true;
    if (["false", "0", "no", "off"].includes(lowered)) return false;
  }
  throw new Error(`${field} must be boolean`);
}

function loadEmailConfigFromAgx(cfg: AgxConfig): EmailConfig {
  const email = cfg.notifications?.email;
  return normalizeEmailConfig(email);
}

function validateEmailConfigPayload(input: unknown): { ok: true; config: EmailConfig } | { ok: false; error: string } {
  if (!input || typeof input !== "object") return { ok: false, error: "invalid payload: object required" };
  const payload = input as Record<string, unknown>;
  for (const key of Object.keys(payload)) {
    if (!EMAIL_CONFIG_KEYS.has(key)) {
      return { ok: false, error: `invalid field: ${key}` };
    }
  }
  let enabled: boolean;
  let smtpUseTls: boolean;
  try {
    enabled = parseBooleanStrict(payload.enabled, "enabled");
    smtpUseTls = parseBooleanStrict(payload.smtp_use_tls, "smtp_use_tls");
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  let smtpPort = 587;
  try {
    smtpPort = intValue(payload.smtp_port, "smtp_port");
  } catch (err) {
    return { ok: false, error: String(err) };
  }
  const normalized: EmailConfig = {
    enabled,
    smtp_host: String(payload.smtp_host ?? "").trim(),
    smtp_port: smtpPort,
    smtp_username: String(payload.smtp_username ?? "").trim(),
    smtp_password: String(payload.smtp_password ?? ""),
    smtp_use_tls: smtpUseTls,
    from_email: String(payload.from_email ?? "").trim(),
    default_to_email: String(payload.default_to_email ?? "bingzhenli@hotmail.com").trim() || "bingzhenli@hotmail.com",
  };
  if (!normalized.smtp_host.trim()) return { ok: false, error: "smtp_host is required" };
  if (!normalized.smtp_username.trim()) return { ok: false, error: "smtp_username is required" };
  if (!normalized.smtp_password.trim()) return { ok: false, error: "smtp_password is required" };
  if (!normalized.from_email.trim()) return { ok: false, error: "from_email is required" };
  if (!normalized.default_to_email.trim()) return { ok: false, error: "default_to_email is required" };
  return { ok: true, config: normalized };
}

function intValue(raw: unknown, field: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed)) throw new Error(`${field} must be integer`);
  return parsed;
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let apiPort = 8000;
const apiToken = crypto.randomBytes(16).toString("hex");
let serveProcess: ChildProcess | null = null;
let isQuitting = false;
let serveStdoutBuffer = "";
let serveStderrBuffer = "";

// Suppress noisy Chromium network diagnostics
// (e.g. chunked upload stream warnings during aborted renderer requests).
// Set AGX_CHROMIUM_QUIET=0 to re-enable Chromium internals logs for debugging.
if (process.env.AGX_CHROMIUM_QUIET !== "0") {
  app.commandLine.appendSwitch("log-level", "3");
  app.commandLine.appendSwitch("disable-logging");
}

function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("failed to pick free port"));
        return;
      }
      const { port } = address;
      server.close(() => resolve(port));
    });
  });
}

function buildMenuTemplate(): MenuItemConstructorOptions[] {
  if (process.platform === "darwin") {
    return [
      {
        label: "AgenticX",
        submenu: [
          { role: "about" },
          { type: "separator" },
          { label: "设置", click: () => mainWindow?.webContents.send("open-settings") },
          { type: "separator" },
          { role: "quit" }
        ]
      },
      {
        label: "Edit",
        submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }]
      },
      {
        label: "Window",
        submenu: [{ role: "minimize" }, { role: "close" }]
      }
    ];
  }
  return [
    { role: "fileMenu" },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" }
  ];
}

function buildAugmentedPath(): string {
  const home = os.homedir();
  const extraPaths = [
    "/opt/miniconda3/bin",
    "/opt/miniconda3/condabin",
    `${home}/miniconda3/bin`,
    `${home}/opt/miniconda3/bin`,
    "/opt/homebrew/bin",
    "/usr/local/bin",
    `${home}/.local/bin`,
    `${home}/bin`,
  ].join(":");
  return `${extraPaths}:${process.env.PATH ?? "/usr/bin:/bin"}`;
}

async function checkAgxCli(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn("/bin/zsh", ["-l", "-c", "agx --version"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, PATH: buildAugmentedPath() },
    });
    let resolved = false;
    const done = (ok: boolean) => {
      if (resolved) return;
      resolved = true;
      clearTimeout(timer);
      try { proc.kill(); } catch { /* noop */ }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 8000);
    proc.on("close", (code) => done(code === 0));
    proc.on("error", () => done(false));
  });
}

async function startStudioServe(): Promise<void> {
  apiPort = await pickFreePort();
  const cmd = `agx serve --host 127.0.0.1 --port ${String(apiPort)}`;
  const desktopHome = os.homedir();
  const augmentedPath = buildAugmentedPath();

  serveProcess = spawn("/bin/zsh", ["-l", "-c", cmd], {
    cwd: desktopHome,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PATH: augmentedPath,
      AGX_DESKTOP_TOKEN: apiToken,
      AGX_WORKSPACE_ROOT: desktopHome,
      AGX_DESKTOP_UNRESTRICTED_FS: "1",
    }
  });
  serveStdoutBuffer = "";
  serveStderrBuffer = "";
  if (serveProcess.stdout) {
    serveProcess.stdout.on("data", (chunk: Buffer) => {
      serveStdoutBuffer = (serveStdoutBuffer + chunk.toString("utf-8")).slice(-4000);
    });
  }
  if (serveProcess.stderr) {
    serveProcess.stderr.on("data", (chunk: Buffer) => {
      serveStderrBuffer = (serveStderrBuffer + chunk.toString("utf-8")).slice(-4000);
    });
  }
}

async function waitServeReady(timeoutMs = 45000): Promise<void> {
  if (!serveProcess || !serveProcess.stdout || !serveProcess.stderr) {
    throw new Error("agx serve process not started");
  }
  const currentProcess = serveProcess;
  const currentStdout = currentProcess.stdout!;
  const currentStderr = currentProcess.stderr!;
  const pingReady = async (): Promise<boolean> => {
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/session`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      return resp.ok;
    } catch {
      return false;
    }
  };
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      cleanup();
      const stderrTail = serveStderrBuffer.trim().slice(-1200);
      const stdoutTail = serveStdoutBuffer.trim().slice(-1200);
      const detail = [message, stderrTail && `stderr:\n${stderrTail}`, stdoutTail && `stdout:\n${stdoutTail}`]
        .filter(Boolean)
        .join("\n\n");
      reject(new Error(detail));
    };
    const markReady = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve();
    };
    const timer = setTimeout(() => {
      void (async () => {
        if (await pingReady()) {
          markReady();
          return;
        }
        fail("agx serve startup timeout");
      })();
    }, timeoutMs);
    const probeTimer = setInterval(() => {
      void (async () => {
        if (settled) return;
        if (await pingReady()) {
          markReady();
        }
      })();
    }, 500);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      if (text.includes("Uvicorn running") || text.includes("AgenticX Studio Server")) {
        markReady();
      }
    };
    const onErrData = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      if (text.includes("Uvicorn running") || text.includes("AgenticX Studio Server")) {
        markReady();
      }
    };
    const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
      fail(`agx serve exited before ready (code=${String(code)}, signal=${String(signal)})`);
    };
    const onError = () => {
      fail("agx serve failed to start");
    };
    const cleanup = () => {
      clearTimeout(timer);
      clearInterval(probeTimer);
      currentStdout.off("data", onData);
      currentStderr.off("data", onErrData);
      currentProcess.off("exit", onExit);
      currentProcess.off("error", onError);
    };
    currentStdout.on("data", onData);
    currentStderr.on("data", onErrData);
    currentProcess.on("exit", onExit);
    currentProcess.on("error", onError);
  });
}

function stopStudioServe(): void {
  if (!serveProcess) {
    return;
  }
  try {
    serveProcess.kill("SIGTERM");
  } catch {
    // noop
  } finally {
    serveProcess = null;
    serveStdoutBuffer = "";
    serveStderrBuffer = "";
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 680,
    minHeight: 480,
    alwaysOnTop: false,
    skipTaskbar: false,
    titleBarStyle: "hiddenInset",
    vibrancy: "under-window",
    visualEffectState: "followWindow",
    backgroundColor: "#00000000",
    roundedCorners: true,
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });
  if (app.isPackaged) {
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    void mainWindow.loadFile(indexPath).catch(() => {});
  } else {
    const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
    void mainWindow.loadURL(devUrl).catch(() => {
      const distFallback = path.join(__dirname, "..", "dist", "index.html");
      if (fs.existsSync(distFallback)) {
        mainWindow?.loadFile(distFallback).catch(() => {});
      } else {
        mainWindow?.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(
          `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;font-family:SF Pro Text,PingFang SC,sans-serif;background:#14141c;color:rgba(255,255,255,.7);-webkit-app-region:drag"><div style="text-align:center"><h3 style="margin:0">无法连接到开发服务器</h3><p style="margin-top:.5rem;font-size:.85rem;opacity:.6">请确保已运行 <code>npm run dev</code></p></div></body></html>`
        )}`).catch(() => {});
      }
    });
  }
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });
}

function createTray(): void {
  const iconPath =
    process.env.NODE_ENV === "development"
      ? path.resolve(process.cwd(), "assets", "trayTemplate.png")
      : path.join(process.resourcesPath, "assets", "trayTemplate.png");
  if (!fs.existsSync(iconPath)) {
    return;
  }
  const icon = nativeImage.createFromPath(iconPath);
  tray = new Tray(icon);
  const menu = Menu.buildFromTemplate([
    {
      label: "打开/隐藏窗口",
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { label: "设置", click: () => mainWindow?.webContents.send("open-settings") },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });
  tray.setToolTip("Machi");
}

function registerIpc(): void {
  ipcMain.handle("get-api-base", async () => `http://127.0.0.1:${apiPort}`);
  ipcMain.handle("get-api-auth-token", async () => apiToken);
  ipcMain.handle("get-platform", async () => process.platform);

  ipcMain.handle("list-avatars", async () => {
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/avatars`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      if (!resp.ok) return { ok: false, avatars: [] };
      return await resp.json();
    } catch {
      return { ok: false, avatars: [] };
    }
  });

  ipcMain.handle("create-avatar", async (_event, payload: { name: string; role?: string; avatar_url?: string; system_prompt?: string; created_by?: string }) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/avatars`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("update-avatar", async (_event, payload: { id: string; name?: string; role?: string; avatar_url?: string; pinned?: boolean; system_prompt?: string }) => {
    const { id, ...body } = payload;
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/avatars/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${text.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("delete-avatar", async (_event, id: string) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/avatars/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-agx-desktop-token": apiToken },
      });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("list-sessions", async (_event, avatarId?: string) => {
    try {
      const params = avatarId ? `?avatar_id=${encodeURIComponent(avatarId)}` : "";
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/sessions${params}`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      if (!resp.ok) return { ok: false, sessions: [] };
      return await resp.json();
    } catch {
      return { ok: false, sessions: [] };
    }
  });

  ipcMain.handle("create-session", async (_event, payload: { avatar_id?: string; name?: string; inherit_from_session_id?: string }) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/sessions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const b = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${b.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("rename-session", async (_event, payload: { sessionId: string; name: string }) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/sessions/${encodeURIComponent(payload.sessionId)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ name: payload.name }),
      });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("delete-session", async (_event, sessionId: string) => {
    const sid = String(sessionId || "").trim();
    if (!sid) return { ok: false, error: "sessionId is required" };
    try {
      const resp = await fetch(
        `http://127.0.0.1:${String(apiPort)}/api/session?session_id=${encodeURIComponent(sid)}`,
        {
          method: "DELETE",
          headers: { "x-agx-desktop-token": apiToken },
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("delete-sessions-batch", async (_event, sessionIds: string[]) => {
    const ids = Array.isArray(sessionIds)
      ? Array.from(new Set(sessionIds.map((id) => String(id || "").trim()).filter(Boolean)))
      : [];
    if (ids.length === 0) return { ok: true, deleted: [], failed: [] };
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/sessions/batch-delete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ session_ids: ids }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}`, deleted: [], failed: ids };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err), deleted: [], failed: ids };
    }
  });

  ipcMain.handle("pin-session", async (_event, payload: { sessionId: string; pinned: boolean }) => {
    const sid = String(payload?.sessionId || "").trim();
    if (!sid) return { ok: false, error: "sessionId is required" };
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/sessions/${encodeURIComponent(sid)}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ pinned: !!payload.pinned }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("fork-session", async (_event, payload: { sessionId: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    if (!sid) return { ok: false, error: "sessionId is required" };
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/sessions/${encodeURIComponent(sid)}/fork`, {
        method: "POST",
        headers: { "x-agx-desktop-token": apiToken },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("archive-sessions", async (_event, payload: { sessionId: string; avatarId?: string | null }) => {
    const sid = String(payload?.sessionId || "").trim();
    const avatarId = String(payload?.avatarId || "").trim();
    if (!sid) return { ok: false, error: "sessionId is required" };
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/sessions/archive-before`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ session_id: sid, avatar_id: avatarId || undefined }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("list-taskspaces", async (_event, sessionId: string) => {
    const sid = String(sessionId || "").trim();
    if (!sid) return { ok: false, workspaces: [], error: "sessionId is required" };
    try {
      const resp = await fetch(
        `http://127.0.0.1:${String(apiPort)}/api/taskspace/workspaces?session_id=${encodeURIComponent(sid)}`,
        {
          headers: { "x-agx-desktop-token": apiToken },
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, workspaces: [], error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, workspaces: [], error: String(err) };
    }
  });

  ipcMain.handle("add-taskspace", async (_event, payload: { sessionId: string; path?: string; label?: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    const dirPath = String(payload?.path || "").trim();
    const label = String(payload?.label || "").trim();
    if (!sid) return { ok: false, error: "sessionId is required" };
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/taskspace/workspaces`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ session_id: sid, path: dirPath || undefined, label: label || undefined }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("remove-taskspace", async (_event, payload: { sessionId: string; taskspaceId: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    const taskspaceId = String(payload?.taskspaceId || "").trim();
    if (!sid || !taskspaceId) return { ok: false, error: "sessionId and taskspaceId are required" };
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/taskspace/workspaces`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ session_id: sid, taskspace_id: taskspaceId }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("choose-directory", async () => {
    const focused = BrowserWindow.getFocusedWindow() ?? mainWindow ?? null;
    try {
      const result = focused
        ? await dialog.showOpenDialog(focused, { properties: ["openDirectory"] })
        : await dialog.showOpenDialog({ properties: ["openDirectory"] });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false, canceled: true };
      }
      return { ok: true, path: result.filePaths[0] };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("list-taskspace-files", async (_event, payload: { sessionId: string; taskspaceId: string; path?: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    const taskspaceId = String(payload?.taskspaceId || "").trim();
    const relPath = String(payload?.path || ".").trim() || ".";
    if (!sid || !taskspaceId) return { ok: false, files: [], error: "sessionId and taskspaceId are required" };
    try {
      const query = `session_id=${encodeURIComponent(sid)}&taskspace_id=${encodeURIComponent(taskspaceId)}&path=${encodeURIComponent(relPath)}`;
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/taskspace/files?${query}`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, files: [], error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, files: [], error: String(err) };
    }
  });

  ipcMain.handle("read-taskspace-file", async (_event, payload: { sessionId: string; taskspaceId: string; path: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    const taskspaceId = String(payload?.taskspaceId || "").trim();
    const relPath = String(payload?.path || "").trim();
    if (!sid || !taskspaceId || !relPath) {
      return { ok: false, error: "sessionId, taskspaceId and path are required" };
    }
    try {
      const query = `session_id=${encodeURIComponent(sid)}&taskspace_id=${encodeURIComponent(taskspaceId)}&path=${encodeURIComponent(relPath)}`;
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/taskspace/file?${query}`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("load-session-messages", async (_event, sessionId: string) => {
    const sid = String(sessionId || "").trim();
    if (!sid) return { ok: false, messages: [], error: "sessionId is required" };
    try {
      const resp = await fetch(
        `http://127.0.0.1:${String(apiPort)}/api/session/messages?session_id=${encodeURIComponent(sid)}`,
        {
          headers: { "x-agx-desktop-token": apiToken },
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, messages: [], error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, messages: [], error: String(err) };
    }
  });

  ipcMain.handle("fork-avatar", async (_event, payload: { sessionId: string; name: string; role?: string }) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/avatars/fork`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ session_id: payload.sessionId, name: payload.name, role: payload.role }),
      });
      if (!resp.ok) {
        const b = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${b.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("generate-avatar", async (_event, payload: { description: string }) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/avatars/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const b = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${b.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("list-groups", async () => {
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/groups`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      if (!resp.ok) return { ok: false, groups: [] };
      return await resp.json();
    } catch {
      return { ok: false, groups: [] };
    }
  });

  ipcMain.handle("create-group", async (_event, payload: { name: string; avatar_ids: string[]; routing?: string }) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/groups`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify(payload),
      });
      if (!resp.ok) {
        const b = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${b.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("update-group", async (_event, payload: { id: string; name?: string; avatar_ids?: string[]; routing?: string }) => {
    const { id, ...body } = payload;
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/groups/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify(body),
      });
      if (!resp.ok) {
        const b = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${b.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("delete-group", async (_event, id: string) => {
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/groups/${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: { "x-agx-desktop-token": apiToken },
      });
      if (!resp.ok) return { ok: false, error: `HTTP ${resp.status}` };
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("load-config", async () => {
    const cfg = loadAgxConfig();
    return {
      defaultProvider: cfg.default_provider ?? "",
      providers: cfg.providers ?? {},
      userMode: cfg.user_mode ?? "pro",
      onboardingCompleted: cfg.onboarding_completed ?? false,
      confirmStrategy: cfg.confirm_strategy ?? "semi-auto",
      activeProvider: cfg.active_provider ?? "",
      activeModel: cfg.active_model ?? "",
    };
  });

  ipcMain.handle("load-email-config", async () => {
    const cfg = loadAgxConfig();
    return { ok: true, config: loadEmailConfigFromAgx(cfg) };
  });

  ipcMain.handle("save-email-config", async (_event, payload: unknown) => {
    const checked = validateEmailConfigPayload(payload);
    if (!checked.ok) return { ok: false, error: checked.error };
    try {
      const cfg = loadAgxConfig();
      const nextNotifications = { ...(cfg.notifications ?? {}) };
      nextNotifications.email = { ...checked.config };
      cfg.notifications = nextNotifications;
      saveAgxConfig(cfg);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: "config_write_failed" };
    }
  });

  ipcMain.handle("test-email-config", async (_event, payload: { config?: unknown; toEmail?: string }) => {
    const checked = validateEmailConfigPayload(payload?.config ?? {});
    if (!checked.ok) return { ok: false, error: checked.error };
    const toEmail = String(payload?.toEmail ?? checked.config.default_to_email).trim() || checked.config.default_to_email;
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/test-email`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agx-desktop-token": apiToken,
        },
        body: JSON.stringify({
          config: checked.config,
          to_email: toEmail,
        }),
      });
      if (!resp.ok) {
        return { ok: false, error: `HTTP ${resp.status}: email_test_failed` };
      }
      return await resp.json();
    } catch {
      return { ok: false, error: "email_test_request_failed" };
    }
  });

  ipcMain.handle("load-mcp-status", async (_event, sessionId: string) => {
    const sid = String(sessionId || "").trim();
    if (!sid) return { ok: false, error: "missing sessionId", servers: [] };
    try {
      const resp = await fetch(
        `http://127.0.0.1:${String(apiPort)}/api/mcp/servers?session_id=${encodeURIComponent(sid)}`,
        {
          headers: { "x-agx-desktop-token": apiToken },
        }
      );
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}`, servers: [] };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err), servers: [] };
    }
  });

  ipcMain.handle("import-mcp-config", async (_event, payload: { sessionId: string; sourcePath: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    const sourcePath = String(payload?.sourcePath || "").trim();
    if (!sid || !sourcePath) return { ok: false, error: "sessionId and sourcePath are required" };
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/mcp/import`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agx-desktop-token": apiToken,
        },
        body: JSON.stringify({ session_id: sid, source_path: sourcePath }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("connect-mcp", async (_event, payload: { sessionId: string; name: string }) => {
    const sid = String(payload?.sessionId || "").trim();
    const name = String(payload?.name || "").trim();
    if (!sid || !name) return { ok: false, error: "sessionId and name are required" };
    try {
      const resp = await fetch(`http://127.0.0.1:${String(apiPort)}/api/mcp/connect`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-agx-desktop-token": apiToken,
        },
        body: JSON.stringify({ session_id: sid, name }),
      });
      if (!resp.ok) {
        const body = await resp.text().catch(() => "");
        return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 300)}` };
      }
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("save-user-mode", async (_event, mode: "pro" | "lite") => {
    const cfg = loadAgxConfig();
    cfg.user_mode = mode;
    saveAgxConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle("save-onboarding-completed", async (_event, completed: boolean) => {
    const cfg = loadAgxConfig();
    cfg.onboarding_completed = completed;
    saveAgxConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle("save-confirm-strategy", async (_event, strategy: "manual" | "semi-auto" | "auto") => {
    const cfg = loadAgxConfig();
    cfg.confirm_strategy = strategy;
    saveAgxConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle("save-provider", async (_event, payload: {
    name: string;
    apiKey?: string;
    baseUrl?: string;
    model?: string;
    models?: string[];
  }) => {
    const cfg = loadAgxConfig();
    if (!cfg.providers) cfg.providers = {};
    const prev = cfg.providers[payload.name] ?? {};
    cfg.providers[payload.name] = {
      ...prev,
      api_key: payload.apiKey ?? prev.api_key,
      base_url: payload.baseUrl ?? prev.base_url,
      model: payload.model ?? prev.model,
      models: payload.models ?? prev.models,
    };
    saveAgxConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle("set-default-provider", async (_event, name: string) => {
    const cfg = loadAgxConfig();
    cfg.default_provider = name;
    saveAgxConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle("delete-provider", async (_event, name: string) => {
    const cfg = loadAgxConfig();
    if (cfg.providers) delete cfg.providers[name];
    if (cfg.default_provider === name) cfg.default_provider = Object.keys(cfg.providers ?? {})[0] ?? "";
    saveAgxConfig(cfg);
    return { ok: true };
  });

  ipcMain.handle("validate-key", async (_event, payload: {
    provider: string;
    apiKey: string;
    baseUrl?: string;
  }) => {
    const base = (payload.baseUrl || KNOWN_BASE_URLS[payload.provider] || "").replace(/\/+$/, "");
    if (!base) return { ok: false, error: "未知 provider，请填写 API 地址" };
    const isMinimax = payload.provider === "minimax";
    const url = isMinimax ? `${base}/chat/completions` : `${base}/models`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const resp = isMinimax
        ? await fetch(url, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${payload.apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "MiniMax-M2.5",
              messages: [{ role: "user", content: "hi" }],
              max_tokens: 1,
            }),
            signal: controller.signal,
          })
        : await fetch(url, {
            headers: { Authorization: `Bearer ${payload.apiKey}` },
            signal: controller.signal,
          });
      clearTimeout(timer);
      if (resp.ok) return { ok: true, status: resp.status };
      const body = await resp.text().catch(() => "");
      return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("fetch-models", async (_event, payload: {
    provider: string;
    apiKey: string;
    baseUrl?: string;
  }) => {
    const base = (payload.baseUrl || KNOWN_BASE_URLS[payload.provider] || "").replace(/\/+$/, "");
    if (!base) return { ok: false, models: [], error: "未知 API 地址" };
    const url = `${base}/models`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(url, {
        headers: { Authorization: `Bearer ${payload.apiKey}` },
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!resp.ok) {
        const fallback = PROVIDER_FALLBACK_MODELS[payload.provider];
        if (resp.status === 404 && Array.isArray(fallback) && fallback.length > 0) {
          return { ok: true, models: fallback };
        }
        return { ok: false, models: [], error: `HTTP ${resp.status}` };
      }
      const data = await resp.json() as { data?: Array<{ id: string }> };
      const models = (data.data ?? []).map((m) => m.id).sort();
      return { ok: true, models };
    } catch (err) {
      return { ok: false, models: [], error: String(err) };
    }
  });

  ipcMain.handle("health-check-model", async (_event, payload: {
    provider: string;
    apiKey: string;
    baseUrl?: string;
    model: string;
  }) => {
    const base = (payload.baseUrl || KNOWN_BASE_URLS[payload.provider] || "").replace(/\/+$/, "");
    if (!base) return { ok: false, error: "未知 API 地址" };
    const url = `${base}/chat/completions`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000);
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${payload.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: payload.model,
          messages: [{ role: "user", content: "hi" }],
          max_tokens: 1,
        }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (resp.ok) return { ok: true, latencyHint: "healthy" };
      const body = await resp.text().catch(() => "");
      return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 200)}` };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  // Legacy compatibility
  ipcMain.handle("save-config", async (_event, payload: { provider?: string; model?: string; apiKey?: string; activeProvider?: string; activeModel?: string }) => {
    const cfg = loadAgxConfig();
    const name = payload.provider || cfg.default_provider || "openai";
    if (!cfg.providers) cfg.providers = {};
    const prev = cfg.providers[name] ?? {};
    cfg.providers[name] = { ...prev };
    if (payload.apiKey) cfg.providers[name].api_key = payload.apiKey;
    if (payload.model) cfg.providers[name].model = payload.model;
    cfg.default_provider = name;
    if (payload.activeProvider) cfg.active_provider = payload.activeProvider;
    if (payload.activeModel) cfg.active_model = payload.activeModel;
    saveAgxConfig(cfg);
    return { ok: true, path: CONFIG_PATH };
  });

  ipcMain.handle("native-say", async (_event, text: string) => {
    if (process.platform !== "darwin") {
      return { ok: false, reason: "not-macos" };
    }
    await new Promise<void>((resolve) => {
      execFile("say", ["-v", "Ting-Ting", text], () => resolve());
    });
    return { ok: true };
  });

  ipcMain.handle("load-skills", async () => {
    const studioUrl = `http://127.0.0.1:${String(apiPort)}`;
    try {
      const resp = await fetch(`${studioUrl}/api/skills`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err), items: [], count: 0 };
    }
  });

  ipcMain.handle("load-skill-detail", async (_event, args: { name: string }) => {
    const studioUrl = `http://127.0.0.1:${String(apiPort)}`;
    try {
      const resp = await fetch(`${studioUrl}/api/skills/${encodeURIComponent(args.name)}`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("refresh-skills", async () => {
    const studioUrl = `http://127.0.0.1:${String(apiPort)}`;
    try {
      const resp = await fetch(`${studioUrl}/api/skills/refresh`, {
        method: "POST",
        headers: { "x-agx-desktop-token": apiToken },
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err), count: 0 };
    }
  });

  ipcMain.handle("load-bundles", async () => {
    const studioUrl = `http://127.0.0.1:${String(apiPort)}`;
    try {
      const resp = await fetch(`${studioUrl}/api/bundles`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err), items: [], count: 0 };
    }
  });

  ipcMain.handle("install-bundle", async (_event, args: { sourcePath: string }) => {
    const studioUrl = `http://127.0.0.1:${String(apiPort)}`;
    try {
      const resp = await fetch(`${studioUrl}/api/bundles/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ source_path: args.sourcePath }),
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("uninstall-bundle", async (_event, args: { name: string }) => {
    const studioUrl = `http://127.0.0.1:${String(apiPort)}`;
    try {
      const resp = await fetch(`${studioUrl}/api/bundles/${encodeURIComponent(args.name)}`, {
        method: "DELETE",
        headers: { "x-agx-desktop-token": apiToken },
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });

  ipcMain.handle("search-registry", async (_event, args: { q: string }) => {
    const studioUrl = `http://127.0.0.1:${String(apiPort)}`;
    try {
      const params = new URLSearchParams({ q: args.q || "" });
      const resp = await fetch(`${studioUrl}/api/registry/search?${params.toString()}`, {
        headers: { "x-agx-desktop-token": apiToken },
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err), items: [], count: 0 };
    }
  });

  ipcMain.handle("install-from-registry", async (_event, args: { source: string; name: string }) => {
    const studioUrl = `http://127.0.0.1:${String(apiPort)}`;
    try {
      const resp = await fetch(`${studioUrl}/api/registry/install`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-agx-desktop-token": apiToken },
        body: JSON.stringify({ source: args.source, name: args.name }),
      });
      return await resp.json();
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  });
}

app.setName("Machi");

app.whenReady().then(async () => {
  try {
    Menu.setApplicationMenu(Menu.buildFromTemplate(buildMenuTemplate()));
    if (process.platform === "darwin") {
      const iconPath = app.isPackaged
        ? path.join(process.resourcesPath, "assets", "icon.png")
        : path.resolve(process.cwd(), "assets", "icon.png");
      if (fs.existsSync(iconPath)) {
        app.dock.setIcon(iconPath);
      }
    }

    const agxOk = await checkAgxCli();
    if (!agxOk) {
      const installDocsUrl = "https://github.com/agenticx/agenticx#installation";
      const { response } = await dialog.showMessageBox({
        type: "warning",
        title: "缺少 agx 命令行工具",
        message: "Machi 需要 agx CLI 才能启动",
        detail: [
          "未检测到 agx 命令，请先在终端运行以下命令安装：",
          "",
          "  curl -sSL https://raw.githubusercontent.com/agenticx/agenticx/main/install.sh | bash",
          "",
          "或者通过 pip 安装：",
          "",
          "  pip install agenticx",
          "",
          "安装完成后重新打开 Machi。",
        ].join("\n"),
        buttons: ["查看安装说明", "退出"],
        defaultId: 0,
        cancelId: 1,
      });
      if (response === 0) {
        void shell.openExternal(installDocsUrl);
      }
      app.quit();
      return;
    }

    registerIpc();
    await startStudioServe();
    await waitServeReady();
    createWindow();
    createTray();
  } catch (error) {
    await dialog.showErrorBox(
      "Machi 启动失败",
      `无法启动本地服务，请检查 agx 是否可用。\n\n${String(error)}`
    );
    app.quit();
  }
});

app.on("activate", () => {
  if (!mainWindow) {
    createWindow();
    return;
  }
  mainWindow.show();
  mainWindow.focus();
});

app.on("before-quit", () => {
  isQuitting = true;
  stopStudioServe();
});
