import { app, BrowserWindow, ipcMain, screen } from "electron";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type SplashStage =
  | "initializing"
  | "backend-starting"
  | "backend-waiting"
  | "pinging-remote"
  | "loading-ui"
  | "restoring-session"
  | "ready";

const SPLASH_WIDTH = 420;
const SPLASH_HEIGHT = 260;
const SPLASH_FADE_MS = 180;
const SPLASH_FORCE_SHOW_MS = 60_000;

let splashWindow: BrowserWindow | null = null;
let splashShownOnce = false;
let rendererReadyReceived = false;
let splashForceShowTimer: NodeJS.Timeout | null = null;
let splashAlwaysOnTopTimer: NodeJS.Timeout | null = null;

type LayoutThemeReader = () => "light" | "dark";

let readLayoutTheme: LayoutThemeReader = () => "dark";

export function configureSplashLayoutThemeReader(reader: LayoutThemeReader): void {
  readLayoutTheme = reader;
}

export function hasSplashBeenShown(): boolean {
  return splashShownOnce;
}

function resolveSplashHtmlPath(): string {
  const packaged = path.join(__dirname, "splash.html");
  if (fs.existsSync(packaged)) return packaged;
  const dev = path.join(process.cwd(), "electron", "splash.html");
  if (fs.existsSync(dev)) return dev;
  return packaged;
}

function resolveSplashPreloadPath(): string {
  const packaged = path.join(__dirname, "splash-preload.js");
  if (fs.existsSync(packaged)) return packaged;
  const dev = path.join(process.cwd(), "dist-electron", "splash-preload.js");
  if (fs.existsSync(dev)) return dev;
  return packaged;
}

function resolveSplashIconPath(): string {
  const iconPath = app.isPackaged
    ? path.join(process.resourcesPath, "assets", "icon.png")
    : path.resolve(process.cwd(), "assets", "icon.png");
  if (fs.existsSync(iconPath)) return iconPath;
  const embedded = app.isPackaged
    ? path.join(process.resourcesPath, "assets", "export_embedded.png")
    : path.resolve(process.cwd(), "assets", "export_embedded.png");
  if (fs.existsSync(embedded)) return embedded;
  return iconPath;
}

function resolveSplashTheme(): "light" | "dark" {
  const theme = readLayoutTheme();
  return theme === "light" ? "light" : "dark";
}

function splashBackgroundColor(theme: "light" | "dark"): string {
  return theme === "light" ? "#ffffff" : "#14141c";
}

function centerSplashBounds(): { x: number; y: number; width: number; height: number } {
  const { workArea } = screen.getPrimaryDisplay();
  const width = SPLASH_WIDTH;
  const height = SPLASH_HEIGHT;
  return {
    width,
    height,
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
  };
}

function clearSplashTimers(): void {
  if (splashForceShowTimer) {
    clearTimeout(splashForceShowTimer);
    splashForceShowTimer = null;
  }
  if (splashAlwaysOnTopTimer) {
    clearTimeout(splashAlwaysOnTopTimer);
    splashAlwaysOnTopTimer = null;
  }
}

function destroySplashWindow(): void {
  clearSplashTimers();
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }
  splashWindow.destroy();
  splashWindow = null;
}

export function updateSplashStage(stage: SplashStage): void {
  if (!splashWindow || splashWindow.isDestroyed()) return;
  splashWindow.webContents.send("splash:stage", stage);
}

export async function closeSplash(options?: { fade?: boolean }): Promise<void> {
  if (!splashWindow || splashWindow.isDestroyed()) {
    splashWindow = null;
    return;
  }
  const win = splashWindow;
  if (options?.fade !== false) {
    try {
      win.webContents.send("splash:stage", "ready");
    } catch {
      // ignore
    }
    await new Promise((resolve) => setTimeout(resolve, SPLASH_FADE_MS));
  }
  destroySplashWindow();
}

export function registerSplashIpcHandlers(deps: {
  showMainWindow: () => void;
  quitApp: () => void;
}): void {
  ipcMain.handle("startup:renderer-ready", async () => {
    if (rendererReadyReceived) return { ok: true, duplicate: true };
    rendererReadyReceived = true;
    updateSplashStage("ready");
    await closeSplash({ fade: true });
    deps.showMainWindow();
    return { ok: true };
  });

  ipcMain.handle("splash-request-quit", async () => {
    deps.quitApp();
    return { ok: true };
  });
}

export function scheduleSplashForceShowFallback(showMainWindow: () => void): void {
  if (splashForceShowTimer) clearTimeout(splashForceShowTimer);
  splashForceShowTimer = setTimeout(() => {
    splashForceShowTimer = null;
    if (rendererReadyReceived) return;
    void (async () => {
      await closeSplash({ fade: false });
      showMainWindow();
    })();
  }, SPLASH_FORCE_SHOW_MS);
}

export function createSplashWindow(): BrowserWindow | null {
  if (splashShownOnce) return null;
  splashShownOnce = true;
  rendererReadyReceived = false;

  const theme = resolveSplashTheme();
  const iconPath = resolveSplashIconPath();
  const logoUrl = fs.existsSync(iconPath) ? pathToFileURL(iconPath).href : "";

  splashWindow = new BrowserWindow({
    ...centerSplashBounds(),
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    transparent: false,
    backgroundColor: splashBackgroundColor(theme),
    autoHideMenuBar: true,
    webPreferences: {
      preload: resolveSplashPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  splashWindow.once("ready-to-show", () => {
    splashWindow?.show();
    updateSplashStage("initializing");
  });

  splashAlwaysOnTopTimer = setTimeout(() => {
    splashAlwaysOnTopTimer = null;
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.setAlwaysOnTop(false);
    }
  }, 5000);

  const htmlPath = resolveSplashHtmlPath();
  const query: Record<string, string> = {
    theme,
  };
  if (logoUrl) query.logo = logoUrl;

  if (fs.existsSync(htmlPath)) {
    void splashWindow.loadFile(htmlPath, { query }).catch((err) => {
      console.warn("[splash] loadFile failed:", err);
      destroySplashWindow();
    });
  } else {
    console.warn("[splash] splash.html not found at", htmlPath);
    destroySplashWindow();
  }

  return splashWindow;
}

export function onMainWindowDidFinishLoad(): void {
  updateSplashStage("restoring-session");
}
