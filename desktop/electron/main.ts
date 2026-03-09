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
  ipcMain.handle("save-config", async (_event, payload: { provider?: string; model?: string; apiKey?: string }) => {
    const configDir = path.join(os.homedir(), ".agenticx");
    fs.mkdirSync(configDir, { recursive: true });
    const configPath = path.join(configDir, "config.yaml");

    const providerName = payload.provider || "openai";
    const yamlLines = [
      `version: "1"`,
      `default_provider: ${providerName}`,
      `providers:`,
      `  ${providerName}:`
    ];
    if (payload.apiKey) yamlLines.push(`    api_key: "${payload.apiKey}"`);
    if (payload.model) yamlLines.push(`    model: ${payload.model}`);

    fs.writeFileSync(configPath, yamlLines.join("\n") + "\n", "utf-8");
    return { ok: true, path: configPath };
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
