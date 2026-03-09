import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  MenuItemConstructorOptions,
  nativeImage,
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
};

const CONFIG_DIR = path.join(os.homedir(), ".agenticx");
const CONFIG_PATH = path.join(CONFIG_DIR, "config.yaml");

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

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let apiPort = 8000;
const apiToken = crypto.randomBytes(16).toString("hex");
let serveProcess: ChildProcess | null = null;
let isQuitting = false;

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

async function startStudioServe(): Promise<void> {
  apiPort = await pickFreePort();
  const cmd = `agx serve --host 127.0.0.1 --port ${String(apiPort)}`;
  // Use login shell to inherit user's PATH (conda/pyenv/etc) in packaged app
  serveProcess = spawn("/bin/zsh", ["-l", "-c", cmd], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, AGX_DESKTOP_TOKEN: apiToken }
  });
}

async function waitServeReady(timeoutMs = 15000): Promise<void> {
  if (!serveProcess || !serveProcess.stdout || !serveProcess.stderr) {
    throw new Error("agx serve process not started");
  }
  const currentProcess = serveProcess;
  const currentStdout = currentProcess.stdout!;
  const currentStderr = currentProcess.stderr!;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("agx serve startup timeout")), timeoutMs);
    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      if (text.includes("Uvicorn running") || text.includes("AgenticX Studio Server")) {
        clearTimeout(timer);
        cleanup();
        resolve();
      }
    };
    const onErrData = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      if (text.toLowerCase().includes("error")) {
        // keep listening; process may still start
      }
    };
    const onExit = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("agx serve exited before ready"));
    };
    const onError = () => {
      clearTimeout(timer);
      cleanup();
      reject(new Error("agx serve failed to start"));
    };
    const cleanup = () => {
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
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 900,
    height: 700,
    minWidth: 680,
    minHeight: 480,
    alwaysOnTop: true,
    skipTaskbar: false,
    titleBarStyle: "hiddenInset",
    vibrancy: "under-window",
    roundedCorners: true,
    trafficLightPosition: { x: 14, y: 14 },
    webPreferences: {
      preload: path.join(__dirname, "preload.js")
    }
  });
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (app.isPackaged) {
    const indexPath = path.join(__dirname, "..", "dist", "index.html");
    void mainWindow.loadFile(indexPath).catch(() => {});
  } else {
    const devUrl = process.env.VITE_DEV_SERVER_URL ?? "http://localhost:5173";
    void mainWindow.loadURL(devUrl).catch(() => {});
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
  tray.setToolTip("AgenticX Desktop");
}

function registerIpc(): void {
  ipcMain.handle("get-api-base", async () => `http://127.0.0.1:${apiPort}`);
  ipcMain.handle("get-api-auth-token", async () => apiToken);
  ipcMain.handle("get-platform", async () => process.platform);

  ipcMain.handle("load-config", async () => {
    const cfg = loadAgxConfig();
    return {
      defaultProvider: cfg.default_provider ?? "",
      providers: cfg.providers ?? {},
    };
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
    const url = `${base}/models`;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const resp = await fetch(url, {
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
      if (!resp.ok) return { ok: false, models: [], error: `HTTP ${resp.status}` };
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
  ipcMain.handle("save-config", async (_event, payload: { provider?: string; model?: string; apiKey?: string }) => {
    const cfg = loadAgxConfig();
    const name = payload.provider || cfg.default_provider || "openai";
    if (!cfg.providers) cfg.providers = {};
    const prev = cfg.providers[name] ?? {};
    cfg.providers[name] = { ...prev };
    if (payload.apiKey) cfg.providers[name].api_key = payload.apiKey;
    if (payload.model) cfg.providers[name].model = payload.model;
    cfg.default_provider = name;
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
}

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
    registerIpc();
    await startStudioServe();
    await waitServeReady();
    createWindow();
    createTray();
  } catch (error) {
    await dialog.showErrorBox(
      "AgenticX Desktop 启动失败",
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
